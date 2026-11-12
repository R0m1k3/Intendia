import { ArrowUp, CornerDownRight, FileText, ListPlus, Loader2, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode, type Ref } from 'react';
import { cx } from '../components/ui';
import { matchCommands, parseCommand, type Command, type CommandName } from './commands';
import type { QueueItem } from './queue';

export interface ComposerHandle {
  /** Adds files as attachments (uploaded at once, one tile each); used by paste, the paperclip and the drop zones. */
  addFiles: (files: File[]) => void;
  focus: () => void;
  /** Replaces the text being written (a message given back after "Annuler le dernier échange"). */
  setText: (text: string) => void;
}

/** Uploads one file; `agentPath` goes into the message, `url` shows the uploaded image. */
export type Upload = (file: File) => Promise<{ agentPath: string; url: string }>;

interface Attachment {
  id: number;
  name: string;
  image: boolean;
  /** Local preview (object URL) while uploading, then the uploaded file's URL. */
  preview: string | null;
  agentPath: string | null;
  state: 'pending' | 'done' | 'failed';
  error?: string;
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
  queue, onQueue, onSteer, steerDisabled, commands, onCommand,
}: {
  onSend: (text: string) => Promise<boolean>;
  /** messages waiting for the end of the run; `paused`: why they wait for « Reprendre » */
  queue?: { items: QueueItem[]; paused: string | null; onRemove: (id: string) => void; onResume: () => void };
  onQueue?: (text: string) => void;
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
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // object URLs still alive, freed when the tile goes, the upload ends or the composer unmounts
  const blobs = useRef(new Set<string>());
  const free = (url: string | null) => { if (url && blobs.current.delete(url)) URL.revokeObjectURL(url); };
  useEffect(() => () => { for (const u of blobs.current) URL.revokeObjectURL(u); blobs.current.clear(); }, []);
  useEffect(() => { onAttachmentsChange?.(files.length); }, [files.length, onAttachmentsChange]);

  const patch = (id: number, p: Partial<Attachment>) => setFiles((list) => list.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const addFiles = (added: File[]) => {
    if (!upload || disabled || !added.length) return;
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
          patch(tile.id, { state: 'done', agentPath: done.agentPath, preview: tile.image ? done.url : null });
        } catch (err) {
          patch(tile.id, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
  };
  const remove = (a: Attachment) => { free(a.preview); setFiles((list) => list.filter((x) => x.id !== a.id)); };

  useImperativeHandle(handle, () => ({ addFiles, focus: () => ref.current?.focus(), setText: (t: string) => { setText(t); ref.current?.focus(); } }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!upload || disabled) return;
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) return;
    e.preventDefault();
    addFiles(pasted.map((f, i) => new File([f], pastedName(f, i, pasted.length), { type: f.type })));
  };

  const waiting = files.some((a) => a.state !== 'done');
  const failed = files.filter((a) => a.state === 'failed');
  const canSend = (text.trim() !== '' || files.length > 0) && !waiting && !sending && !disabled;
  // what was sent: a file added or text typed while the send is pending stays in the draft
  const submit = async (how: (message: string) => Promise<boolean>) => {
    const message = [text.trim(), ...files.map((a) => a.agentPath)].filter(Boolean).join('\n');
    const sentText = text;
    const sent = new Set(files.map((a) => a.id));
    setSending(true);
    const ok = await how(message);
    setSending(false);
    if (ok) {
      setText((t) => (t === sentText ? '' : t));
      for (const a of files) free(a.preview);
      setFiles((all) => all.filter((a) => !sent.has(a.id)));
    }
  };
  const send = async () => {
    if (!canSend || running) return;
    await submit(onSend);
  };
  const menu = commands && onCommand && !disabled && !sending && closedFor !== text ? matchCommands(text, commands) : null;
  const picked = menu ? menu[Math.min(pick, menu.length - 1)]! : null;
  const edit = (t: string) => { setText(t); setPick(0); setCommandNote(null); };
  /** Runs the command written in the text; false = the text is an ordinary message. */
  const runCommand = async (): Promise<boolean> => {
    if (!commands || !onCommand || sending) return false;
    const found = parseCommand(text, commands);
    if (!found) return false;
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
    await submit(async (m) => { onQueue(m); return true; });
  };
  // a reorientation is text only: files would be cited before they are seen
  const steerBlock = files.length > 0 ? 'Réorienter n’accepte pas de pièces jointes' : steerDisabled;
  const canSteer = Boolean(onSteer) && text.trim() !== '' && !sending && !disabled && !steerBlock;
  const steer = async () => {
    if (!canSteer || !running || !onSteer) return;
    if (await runCommand()) return;
    await submit(onSteer);
  };
  const iconButton = 'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40';

  return (
    <div className={cx('card p-2 transition-colors focus-within:border-ink-faint/60', disabled && 'opacity-60')}>
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
                <button type="button" onClick={queue.onResume} className="font-medium text-accent hover:underline">Reprendre</button>
              </>
            ) : running ? 'Envoyé à la fin du travail en cours, un message à la fois' : (
              <button type="button" onClick={queue.onResume} className="font-medium text-accent hover:underline">Envoyer le suivant</button>
            )}
          </p>
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pb-1 pt-1" aria-label="Pièces jointes">
          {files.map((a) => <Tile key={a.id} a={a} onRemove={() => remove(a)} />)}
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
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void enter();
          }
        }}
        placeholder={placeholder ?? 'Écrire à l’agent'}
        aria-label="Message"
        className="block max-h-60 min-h-9 w-full resize-none bg-transparent px-2 py-2 text-sm placeholder:text-ink-faint focus:outline-none"
      />
      {commandNote && <p role="status" data-command-note className="px-2 pb-1 text-[12px] text-ink-soft">{commandNote}</p>}
      <div className="flex items-center gap-1">
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
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
            >
              <Paperclip className="size-4" strokeWidth={1.5} />
            </button>
          </>
        )}
        <div className="hidden min-w-0 flex-1 truncate px-1 text-[11px] text-ink-faint md:block">{hint}</div>
        <div className="flex min-w-0 flex-1 justify-end md:flex-none">{options}</div>
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
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink transition-colors hover:bg-raised"
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
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-40"
          >
            <ArrowUp className="size-4" strokeWidth={1.75} />
          </button>
        )}
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
          <FileText className="size-3.5 shrink-0" strokeWidth={1.5} />
          <span>{a.name}</span>
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

/** collage-2026-11-10-143205.png (-2, -3… when several files come in one paste); keeps real file names. */
function pastedName(f: File, i: number, count: number): string {
  if (f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f.name;
  const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `collage-${stamp}${count > 1 ? `-${i + 1}` : ''}.${ext}`;
}
