import { ArrowUp, CornerDownRight, FileText, FolderArchive, ShieldOff, Sparkles, ListPlus, Loader2, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode, type Ref } from 'react';
import type { ExtractResult } from '../api';
import { cx } from '../components/ui';
import { clearDraft, loadDraft, onFlush, saveDraft } from './draft';
import { insertAt } from './insert';
import { PromptPicker } from './PromptPicker';
import { matchCommands, matchSkills, parseCommand, type Command, type CommandName } from './commands';
import type { QueueItem } from './queue';

export interface ComposerHandle {
  /** Adds files as attachments (uploaded at once, one tile each); used by paste, the paperclip and the drop zones. */
  addFiles: (files: File[]) => void;
  focus: () => void;
  /** Replaces the text being written (a message given back after "Annuler le dernier échange"). */
  setText: (text: string) => void;
  /** Opens the prompts list (/prompt), filtered by the start of a title. */
  openPrompts: (filter?: string) => void;
  /** Inserts a text (a file path) at the cursor, keeping the rest; at the end when the field never had the focus. */
  insert: (text: string) => void;
}

/** Uploads one file; `agentPath` goes into the message, `url` shows the uploaded image, `path` = in the workspace. */
export type Upload = (file: File) => Promise<{ agentPath: string; url: string; path: string }>;
/** Unpacks an uploaded archive next to it (workspace path). */
export type ExtractArchive = (path: string) => Promise<ExtractResult>;

/** A pasted text longer than this becomes a .txt attachment. */
export const LONG_PASTE = 4000;
export const isArchive = (name: string) => /.\.(zip|tar|tgz|tar\.gz)$/i.test(name);

interface Attachment {
  id: number;
  name: string;
  image: boolean;
  /** Local preview (object URL) while uploading, then the uploaded file's URL. */
  preview: string | null;
  agentPath: string | null;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  /** under the name: « Décompression… », « 12 fichiers dans inbox/x/ », why the archive stayed packed */
  note?: string;
}

let nextId = 1;

/**
 * Enter sends, Shift+Enter goes to the next line; while a run goes, the button stops it, Enter puts the message in the
 * queue (`onQueue`, shown above the text) and « Réorienter » (`onSteer`) gives the text to the agent at once.
 * Files (paperclip, paste of a screenshot, drop zones of the page) become tiles above the text: uploaded to inbox/
 * one by one (`upload`), image thumbnails, a state while uploading or after a failure. Their paths are added to the
 * message only when it is sent, one per line after the text: that is how the agent reads them. Sending waits for
 * every tile to be uploaded; a failed tile must be removed first.
 * Bottom bar: `leading` (home page: the workspace) before the paperclip, `hint` (keys) in the middle on wide
 * screens, `options` (session: model, effort) right of it, before the send button.
 * Slash commands (`commands`, session page): a menu while « /name » is typed (↑/↓, Entrée or Tab, Échap); a known
 * command is run by `onCommand` (true = done, the text goes), even during a run; any other « /… » text is a message.
 */
export function Composer({
  onSend, onStop, running, disabled, placeholder, upload, onAttachmentsChange, leading, options, hint, ref: handle,
  queue, onQueue, onSteer, steerDisabled, commands, onCommand, draftKey, extract, prompts, skillNames, autoApprove, notice,
}: {
  /** skills offered by `/use` (activated ones of the session's agent) */
  skillNames?: string[];
  /** « Sans confirmation » is on: a pill above the text, a click turns it off */
  autoApprove?: { onOff: () => void } | null;
  /** a line under the text (e.g. a personality left out of the last run) */
  notice?: string | null;
  /** localStorage key of the draft (chat/draft.ts); none = not kept */
  draftKey?: string;
  extract?: ExtractArchive;
  /** the « Prompts » button (saved prompts) */
  prompts?: boolean;
  /** `skills`: asked by `/use` for this message */
  onSend: (text: string, skills?: string[]) => Promise<boolean>;
  /** messages waiting for the end of the run; `paused`: why they wait for « Reprendre » */
  queue?: { items: QueueItem[]; paused: string | null; onRemove: (id: string) => void; onResume: () => void };
  onQueue?: (text: string, skills?: string[]) => void;
  /** true when the agent took the text */
  onSteer?: (text: string) => Promise<boolean>;
  /** why « Réorienter » cannot be used now (shown as its title) */
  steerDisabled?: string;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
  upload?: Upload;
  onAttachmentsChange?: (count: number) => void;
  leading?: ReactNode;
  options?: ReactNode;
  hint?: ReactNode;
  ref?: Ref<ComposerHandle>;
  commands?: Command[];
  onCommand?: (name: CommandName, arg: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  // slash menu: highlighted line, text for which Échap closed it, why the last command could not run
  const [pick, setPick] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [commandNote, setCommandNote] = useState<string | null>(null);
  // a long paste made into a file: « Remettre en texte » until the next send
  const [pastedText, setPastedText] = useState<{ id: number; text: string } | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptFilter, setPromptFilter] = useState('');
  // skills asked by /use for the next message (3 at most)
  const [skills, setSkills] = useState<string[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // object URLs still alive, freed when the tile goes, the upload ends or the composer unmounts
  const blobs = useRef(new Set<string>());
  const free = (url: string | null) => { if (url && blobs.current.delete(url)) URL.revokeObjectURL(url); };
  useEffect(() => () => { for (const u of blobs.current) URL.revokeObjectURL(u); blobs.current.clear(); }, []);
  useEffect(() => { onAttachmentsChange?.(files.length); }, [files.length, onAttachmentsChange]);

  // draft: read when the key comes (the session page may give another text just after: it wins), written 400 ms
  // after the last key stroke and when the composer goes
  const latest = useRef({ key: draftKey, text });
  latest.current = { key: draftKey, text };
  useEffect(() => {
    if (draftKey) setText(loadDraft(draftKey));
    // only a text is saved here: before the loaded draft is rendered (StrictMode runs this twice), the text is still
    // empty and must not erase it; clearing goes through the timer below and the send
    return () => { const l = latest.current; if (l.key && l.text.trim()) saveDraft(l.key, l.text); };
  }, [draftKey]);
  // saved at once when the side chat's iframe is about to go (same rule as the cleanup above)
  useEffect(() => onFlush(() => { const l = latest.current; if (l.key && l.text.trim()) saveDraft(l.key, l.text); }), []);
  useEffect(() => {
    if (!draftKey) return;
    const id = setTimeout(() => saveDraft(draftKey, text), 400);
    return () => clearTimeout(id);
  }, [draftKey, text]);

  const patch = (id: number, p: Partial<Attachment>) => setFiles((list) => list.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const addFiles = (added: File[]): number[] => {
    if (!upload || disabled || !added.length) return [];
    const tiles = added.map((f) => {
      const image = f.type.startsWith('image/');
      const preview = image ? URL.createObjectURL(f) : null;
      if (preview) blobs.current.add(preview);
      return { file: f, tile: { id: nextId++, name: f.name, image, preview, agentPath: null, state: 'pending' as const } };
    });
    setFiles((list) => [...list, ...tiles.map((t) => t.tile)]);
    ref.current?.focus();
    void (async () => {
      for (const { file, tile } of tiles) {
        try {
          const done = await upload(file);
          free(tile.preview);
          const preview = tile.image ? done.url : null;
          if (extract && isArchive(file.name)) {
            patch(tile.id, { preview, note: 'Décompression…' });
            patch(tile.id, await unpack(done, extract));
          } else {
            patch(tile.id, { state: 'done', agentPath: done.agentPath, preview });
          }
        } catch (err) {
          patch(tile.id, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return tiles.map((t) => t.tile.id);
  };
  const remove = (a: Attachment) => {
    free(a.preview);
    setFiles((list) => list.filter((x) => x.id !== a.id));
    if (pastedText?.id === a.id) setPastedText(null);
  };

  const hadFocus = useRef(false);
  /** Inserted at the cursor; an empty composer takes the text as is. */
  const insertText = (t: string) => {
    const el = ref.current;
    if (!text.trim() || !el) { edit(t); el?.focus(); return; }
    const at = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? at;
    edit(text.slice(0, at) + t + text.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + t.length, at + t.length); });
  };
  const unpaste = () => {
    if (!pastedText) return;
    const tile = files.find((a) => a.id === pastedText.id);
    if (tile) remove(tile);
    setPastedText(null);
    insertText(pastedText.text);
  };

  useImperativeHandle(handle, () => ({
    addFiles: (f: File[]) => { addFiles(f); },
    focus: () => ref.current?.focus(),
    setText: (t: string) => { setText(t); ref.current?.focus(); },
    openPrompts: (filter = '') => { setPromptFilter(filter); setPromptsOpen(true); },
    insert: (t: string) => {
      const el = ref.current;
      const [start, end] = el && hadFocus.current ? [el.selectionStart ?? text.length, el.selectionEnd ?? text.length] : [text.length, text.length];
      const next = insertAt(text, start, end, t);
      edit(next.value);
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next.caret, next.caret); });
    },
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!upload || disabled) return;
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) {
      const t = e.clipboardData.getData('text/plain');
      if (t.length <= LONG_PASTE) return;
      e.preventDefault();
      const [id] = addFiles([new File([t], pastedTextName(), { type: 'text/plain' })]);
      if (id !== undefined) setPastedText({ id, text: t });
      return;
    }
    e.preventDefault();
    addFiles(pasted.map((f, i) => new File([f], pastedName(f, i, pasted.length), { type: f.type })));
  };

  const waiting = files.some((a) => a.state !== 'done');
  const failed = files.filter((a) => a.state === 'failed');
  const canSend = (text.trim() !== '' || files.length > 0) && !waiting && !sending && !disabled;
  // what was sent: a file added or text typed while the send is pending stays in the draft
  const submit = async (how: (message: string, skills?: string[]) => Promise<boolean>) => {
    const message = [text.trim(), ...files.map((a) => a.agentPath)].filter(Boolean).join('\n');
    const sentText = text;
    const sent = new Set(files.map((a) => a.id));
    const sentSkills = skills;
    setSending(true);
    const ok = await how(message, sentSkills.length ? sentSkills : undefined);
    setSending(false);
    if (ok) {
      setText((t) => (t === sentText ? '' : t));
      if (draftKey && latest.current.text === sentText) clearDraft(draftKey);
      for (const a of files) free(a.preview);
      setFiles((all) => all.filter((a) => !sent.has(a.id)));
      setPastedText(null);
      setSkills((now) => (now === sentSkills ? [] : now));
    }
  };
  const send = async () => {
    if (!canSend || running) return;
    await submit(onSend);
  };
  const menu = commands && onCommand && !disabled && !sending && closedFor !== text ? matchCommands(text, commands) : null;
  const skillMenu = !menu && skillNames && !disabled && !sending && closedFor !== text ? matchSkills(text, skillNames) : null;
  const pickedSkill = skillMenu ? skillMenu[Math.min(pick, skillMenu.length - 1)]! : null;
  const addSkill = (name: string) => {
    if (skills.includes(name)) { edit(''); return; }
    if (skills.length >= 3) { setCommandNote('3 skills au plus par message'); return; }
    setSkills([...skills, name]);
    edit('');
    ref.current?.focus();
  };
  const picked = menu ? menu[Math.min(pick, menu.length - 1)]! : null;
  const edit = (t: string) => { setText(t); setPick(0); setCommandNote(null); };
  /** Runs the command written in the text; false = the text is an ordinary message. */
  const runCommand = async (): Promise<boolean> => {
    if (!commands || !onCommand || sending) return false;
    const found = parseCommand(text, commands);
    if (!found) return false;
    // /use <skill> stays in the composer: a pill for the next message
    if (found.command.name === 'use' && !found.command.disabled) {
      if (skillNames?.includes(found.arg)) addSkill(found.arg);
      else setCommandNote(found.arg ? `Skill inconnu ou désactivé : ${found.arg}` : 'Écrivez le nom du skill après /use');
      return true;
    }
    if (found.command.disabled) { setCommandNote(`/${found.command.name} : ${found.command.disabled}`); return true; }
    const sentText = text;
    setSending(true);
    const ok = await onCommand(found.command.name, found.arg).catch(() => false);
    setSending(false);
    if (ok) setText((t) => (t === sentText ? '' : t));
    return true;
  };
  const choose = async (c: Command) => {
    if (sending) return;
    // a command with an argument: its name goes in the text, the user goes on typing
    if (c.args) { edit(`/${c.name} `); ref.current?.focus(); return; }
    setText(`/${c.name}`);
    if (c.disabled) { setCommandNote(`/${c.name} : ${c.disabled}`); setClosedFor(`/${c.name}`); return; }
    setSending(true);
    const ok = await onCommand!(c.name, '').catch(() => false);
    setSending(false);
    setText((t) => (ok && t === `/${c.name}` ? '' : t));
  };
  const enter = async () => {
    if (await runCommand()) return;
    await (running ? toQueue() : send());
  };
  // every way of sending the text runs a command first: « /stop » must never reach the agent or the queue
  const queueOrCommand = async () => { if (!(await runCommand())) await toQueue(); };
  const toQueue = async () => {
    if (!canSend || !running || !onQueue) return;
    await submit(async (m, sk) => { onQueue(m, sk); return true; });
  };
  // a reorientation is text only: files would be cited before they are seen
  const steerBlock = files.length > 0 ? 'Réorienter n’accepte pas de pièces jointes'
    : skills.length > 0 ? 'Réorienter n’accepte pas de skill' : steerDisabled;
  const canSteer = Boolean(onSteer) && text.trim() !== '' && !sending && !disabled && !steerBlock;
  const steer = async () => {
    if (!canSteer || !running || !onSteer) return;
    if (await runCommand()) return;
    await submit(onSteer);
  };
  const iconButton = 'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40';

  return (
    <div className={cx('card p-2 pl-2.5 transition-colors focus-within:border-ink-faint', disabled && 'opacity-60')}>
      {queue && queue.items.length > 0 && (
        <div className="px-1 pb-1.5 pt-1" data-queue>
          <ul className="flex flex-wrap gap-1.5" aria-label="Messages en attente">
            {queue.items.map((q, i) => (
              <li key={q.id} data-queued className="flex max-w-full items-center gap-1 rounded-full border border-line bg-raised py-0.5 pl-2.5 pr-1 text-xs">
                <span className="text-ink-faint">{i + 1}.</span>
                <span className="max-w-[16rem] truncate" title={q.text}>{q.text}</span>
                <button type="button" onClick={() => queue.onRemove(q.id)} aria-label={`Retirer « ${q.text.slice(0, 40)} » de la file`}
                  className="flex size-5 items-center justify-center rounded-full text-ink-faint hover:bg-sheet hover:text-ink">
                  <X className="size-3" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-ink-faint">
            {queue.paused ? (
              <>
                En pause : {queue.paused} ·{' '}
                <button type="button" onClick={queue.onResume} className="font-medium text-accent-ink hover:underline">Reprendre</button>
              </>
            ) : running ? 'Envoyé à la fin du travail en cours, un message à la fois' : (
              <button type="button" onClick={queue.onResume} className="font-medium text-accent-ink hover:underline">Envoyer le suivant</button>
            )}
          </p>
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pb-1 pt-1" aria-label="Pièces jointes">
          {files.map((a) => <Tile key={a.id} a={a} onRemove={() => remove(a)} />)}
        </ul>
      )}
      {pastedText && files.some((a) => a.id === pastedText.id) && (
        <p data-long-paste className="px-1.5 pb-1 text-[12px] text-ink-soft">
          Texte collé joint en fichier ({pastedText.text.length.toLocaleString('fr-FR')} caractères) ·{' '}
          <button type="button" onClick={unpaste} className="font-medium text-accent-ink hover:underline">Remettre en texte</button>
        </p>
      )}
      {(skills.length > 0 || autoApprove) && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1 pt-1">
          {autoApprove && (
            <button type="button" data-auto-approve onClick={autoApprove.onOff} title="L’agent agit sans demander votre accord. Cliquer pour redemander l’accord."
              className="flex items-center gap-1 rounded-full border border-warn/40 bg-warn-soft px-2.5 py-0.5 text-xs text-warn hover:border-warn">
              <ShieldOff className="size-3" strokeWidth={2} /> Sans confirmation <X className="size-3" strokeWidth={2} />
            </button>
          )}
          {skills.map((name) => (
            <span key={name} data-skill-pill={name} className="flex items-center gap-1 rounded-full border border-line bg-raised py-0.5 pl-2.5 pr-1 text-xs">
              <Sparkles className="size-3 text-ink-faint" strokeWidth={1.75} /> Skill : <span className="font-mono">{name}</span>
              <button type="button" onClick={() => setSkills(skills.filter((x) => x !== name))} aria-label={`Retirer le skill ${name}`}
                className="flex size-5 items-center justify-center rounded-full text-ink-faint hover:bg-sheet hover:text-ink">
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      {skillMenu && (
        <ul role="listbox" aria-label="Skills" data-skills className="mb-1 max-h-64 overflow-y-auto border-b border-line px-1 pb-1">
          {skillMenu.map((name) => (
            <li key={name} role="option" aria-selected={name === pickedSkill}
              onMouseDown={(e) => { e.preventDefault(); addSkill(name); }}
              onMouseEnter={() => setPick(skillMenu.indexOf(name))}
              className={cx('flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 font-mono text-[13px]', name === pickedSkill && 'bg-raised')}>
              {name}
            </li>
          ))}
        </ul>
      )}
      {menu && (
        <ul role="listbox" aria-label="Commandes" data-commands className="mb-1 max-h-64 overflow-y-auto border-b border-line px-1 pb-1">
          {menu.map((c) => (
            <li key={c.name} role="option" aria-selected={c === picked} aria-disabled={Boolean(c.disabled)}
              onMouseDown={(e) => { e.preventDefault(); void choose(c); }}
              onMouseEnter={() => setPick(menu.indexOf(c))}
              title={c.disabled}
              className={cx('flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-sm', c === picked && 'bg-raised', c.disabled && 'opacity-50')}>
              <span className="font-mono text-[13px]">/{c.name}{c.args ? <span className="text-ink-faint"> {c.args}</span> : null}</span>
              <span className="truncate text-ink-soft">{c.label}</span>
              {c.disabled && <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{c.disabled}</span>}
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && (
        <p role="alert" className="px-1.5 pb-1 text-[12px] text-bad">
          {failed.length === 1 ? 'Pièce jointe non envoyée' : `${failed.length} pièces jointes non envoyées`}
          {' '}({failed.map((a) => a.error ?? a.name).join(' ; ')}). {failed.length === 1 ? 'Retirez-la' : 'Retirez-les'} pour envoyer le message.
        </p>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => edit(e.target.value)}
        onFocus={() => { hadFocus.current = true; }}
        onPaste={paste}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (menu && picked) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const i = menu.indexOf(picked) + (e.key === 'ArrowDown' ? 1 : -1);
              setPick((i + menu.length) % menu.length);
              return;
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); void choose(picked); return; }
            if (e.key === 'Escape') { e.preventDefault(); setClosedFor(text); return; }
          }
          if (skillMenu && pickedSkill) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const i = skillMenu.indexOf(pickedSkill) + (e.key === 'ArrowDown' ? 1 : -1);
              setPick((i + skillMenu.length) % skillMenu.length);
              return;
            }
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); addSkill(pickedSkill); return; }
            if (e.key === 'Escape') { e.preventDefault(); setClosedFor(text); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void enter();
          }
        }}
        placeholder={placeholder ?? 'Écrire à l’agent'}
        aria-label="Message"
        className="block max-h-60 min-h-9 w-full resize-none bg-transparent px-1.5 py-1.5 text-[15px] placeholder:text-ink-faint focus:outline-none"
      />
      {commandNote && <p role="status" data-command-note className="px-2 pb-1 text-[12px] text-ink-soft">{commandNote}</p>}
      {notice && <p role="status" data-run-notice className="px-2 pb-1 text-[12px] text-warn">{notice}</p>}
      {/* sized by the composer, not the window: a Chat column can be narrow on a wide screen */}
      <div className="@container">
      <div className="flex flex-wrap items-center gap-1 @2xl:flex-nowrap">
        {leading}
        {upload && (
          <>
            <input ref={picker} type="file" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) addFiles(f); }} />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={disabled}
              aria-label="Joindre des fichiers"
              title="Joindre des fichiers (déposés dans inbox/)"
              className="flex size-[34px] shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              <Paperclip className="size-4" strokeWidth={1.5} />
            </button>
          </>
        )}
        {prompts && (
          <PromptPicker
            open={promptsOpen} onOpenChange={(o) => { setPromptsOpen(o); if (!o) setPromptFilter(''); }}
            filter={promptFilter} text={text} disabled={disabled} onInsert={insertText}
          />
        )}
        <div className="min-w-0 flex-1 truncate px-1 text-[11px] text-ink-faint">{hint}</div>
        {/* narrow: the options get their own line above the buttons, the hint stays on the buttons' line */}
        <div data-composer-options className="order-first flex min-w-0 basis-full overflow-x-auto [scrollbar-width:none] @2xl:order-none @2xl:basis-auto @2xl:flex-none">{options}</div>
        {running && onSteer && (
          <button type="button" onClick={() => void steer()} disabled={!canSteer} aria-label="Réorienter"
            title={steerBlock ?? 'Réorienter : donner ce texte à l’agent tout de suite, après ses outils en cours'}
            className={cx(iconButton, 'text-ink-soft hover:bg-raised hover:text-ink')}>
            <CornerDownRight className="size-4" strokeWidth={1.5} />
          </button>
        )}
        {running && onQueue && (
          <button type="button" onClick={() => void queueOrCommand()} disabled={!canSend} aria-label="Mettre en file"
            title="Mettre en file (Entrée) : envoyé à la fin du travail en cours"
            className={cx(iconButton, 'text-ink-soft hover:bg-raised hover:text-ink')}>
            <ListPlus className="size-4" strokeWidth={1.5} />
          </button>
        )}
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Arrêter"
            title="Arrêter"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line text-ink transition-colors hover:bg-raised"
          >
            <Square className="size-3.5 fill-current" strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enter()}
            disabled={!canSend}
            aria-label="Envoyer"
            title={waiting ? (files.some((a) => a.state === 'failed') ? 'Retirez les pièces jointes en échec' : 'Envoi des pièces jointes…') : 'Envoyer (Entrée)'}
            className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-accent-strong bg-accent text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-40"
          >
            <ArrowUp className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

function Tile({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const failed = a.state === 'failed';
  return (
    <li
      data-attachment={a.state} title={failed ? `Échec : ${a.error ?? ''}` : a.name}
      className={cx('group relative', a.image ? 'size-16' : 'flex h-16 max-w-[14rem] items-center')}
    >
      {a.image && a.preview ? (
        <img src={a.preview} alt={a.name} className={cx('size-16 rounded-lg border object-cover', failed ? 'border-bad' : 'border-line')} />
      ) : (
        <span className={cx('file-chip h-9', failed && '!border-bad')}>
          {a.note ? <FolderArchive className="size-3.5 shrink-0" strokeWidth={1.5} /> : <FileText className="size-3.5 shrink-0" strokeWidth={1.5} />}
          <span className="min-w-0">
            <span className="block truncate">{a.name}</span>
            {a.note && <span data-archive-note className="block truncate text-[11px] text-ink-faint">{a.note}</span>}
          </span>
        </span>
      )}
      {a.state === 'pending' && (
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-sheet/60" aria-label="Envoi…">
          <Loader2 className="size-4 animate-spin text-ink-soft" strokeWidth={1.75} />
        </span>
      )}
      <button
        type="button" onClick={onRemove} aria-label={`Retirer ${a.name}`} title={`Retirer ${a.name}`}
        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-sheet text-ink-soft shadow-sm hover:text-ink"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </li>
  );
}

/** After the upload of an archive: the tile points at the folder made from it, or stays the archive (with why). */
async function unpack(done: { agentPath: string; path: string }, extract: ExtractArchive): Promise<Partial<Attachment>> {
  try {
    const r = await extract(done.path);
    const agentPath = done.agentPath.slice(0, done.agentPath.length - done.path.length) + r.folder;
    const n = r.count === 1 ? '1 fichier' : `${r.count} fichiers`;
    const extra = [r.skipped.length ? `${r.skipped.length} ignorés` : '', r.partial ? 'incomplet' : ''].filter(Boolean).join(', ');
    return { state: 'done', agentPath, note: `${n} dans ${r.folder}/${extra ? ` (${extra})` : ''}` };
  } catch (err) {
    return { state: 'done', agentPath: done.agentPath, note: `Non décompressée : ${err instanceof Error ? err.message : String(err)}` };
  }
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** collage-2026-11-12-143205.txt */
export const pastedTextName = () => `collage-${stamp()}.txt`;

/** collage-2026-11-10-143205.png (-2, -3… when several files come in one paste); keeps real file names. */
function pastedName(f: File, i: number, count: number): string {
  if (f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f.name;
  const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  return `collage-${stamp()}${count > 1 ? `-${i + 1}` : ''}.${ext}`;
}
