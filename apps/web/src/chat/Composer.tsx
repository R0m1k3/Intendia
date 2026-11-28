// The message field: the composition of its units (chat/composer/): the draft, the attachments, the slash menus
// and the list of messages waiting; the sends (message, queue, reorientation) stay here.
import { ArrowUp, CornerDownRight, ShieldOff, Sparkles, ListPlus, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import type { ExtractResult } from '../api';
import { cx } from '../components/ui';
import { locale, plural, t } from '../i18n';
import { clearDraft } from './draft';
import { insertAt } from './insert';
import { PromptPicker } from './PromptPicker';
import type { Command, CommandName } from './commands';
import { QueueList } from './composer/QueueList';
import { Tile, useAttachments } from './composer/useAttachments';
import { useDraft } from './composer/useDraft';
import { SlashMenuLists, useSlashMenus } from './composer/useSlashMenus';
import type { QueueItem } from './queue';

// moved to chat/composer/useAttachments.tsx; still importable from here
export { isArchive, LONG_PASTE, pastedTextName } from './composer/useAttachments';

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
  queue, onQueue, onSteer, steerDisabled, commands, onCommand, draftKey, extract, prompts, skillNames, autoApprove,
}: {
  /** skills offered by `/use` (activated ones of the session's agent) */
  skillNames?: string[];
  /** « Sans confirmation » is on: a pill above the text, a click turns it off */
  autoApprove?: { onOff: () => void } | null;
  /** localStorage key of the draft (chat/draft.ts); none = not kept */
  draftKey?: string;
  extract?: ExtractArchive;
  /** the « Prompts » button (saved prompts) */
  prompts?: boolean;
  /** `skills`: asked by `/use` for this message */
  onSend: (text: string, skills?: string[]) => Promise<boolean>;
  /** messages waiting for the end of the run; `paused`: why they wait for « Reprendre » */
  queue?: {
    items: QueueItem[]; paused: string | null; onRemove: (id: string) => void; onResume: () => void;
    /** −1 up, +1 down */
    onMove?: (id: string, delta: number) => void;
    onEdit?: (id: string, text: string) => void;
    /** gives this message to the agent at once (a reorientation while it works); null: not possible now (why) */
    onSendNow?: (id: string) => void; sendNowBlocked?: (item: QueueItem) => string | null;
  };
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
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptFilter, setPromptFilter] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { files, setFiles, free, addFiles, remove, paste, pastedText, setPastedText } = useAttachments({ upload, extract, disabled, onAttachmentsChange, textarea: ref });
  const latest = useDraft(draftKey, text, setText);
  const slash = useSlashMenus({ text, setText, sending, setSending, disabled, commands, onCommand, skillNames, textarea: ref });
  const { skills, setSkills, commandNote, edit, runCommand } = slash;

  const hadFocus = useRef(false);
  /** Inserted at the cursor; an empty composer takes the text as is. */
  const insertText = (str: string) => {
    const el = ref.current;
    if (!text.trim() || !el) { edit(str); el?.focus(); return; }
    const at = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? at;
    edit(text.slice(0, at) + str + text.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + str.length, at + str.length); });
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
    setText: (str: string) => { setText(str); ref.current?.focus(); },
    openPrompts: (filter = '') => { setPromptFilter(filter); setPromptsOpen(true); },
    insert: (str: string) => {
      const el = ref.current;
      const [start, end] = el && hadFocus.current ? [el.selectionStart ?? text.length, el.selectionEnd ?? text.length] : [text.length, text.length];
      const next = insertAt(text, start, end, str);
      edit(next.value);
      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next.caret, next.caret); });
    },
  }));

  // biome-ignore lint/correctness/useExhaustiveDependencies(text): the trigger, not read by the effect: it runs again when this changes
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const waiting = files.some((a) => a.state !== 'done');
  const failed = files.filter((a) => a.state === 'failed');
  const canSend = (text.trim() !== '' || files.length > 0) && !waiting && !sending && !disabled;
  // what was sent: a file added or text typed while the send is pending stays in the draft
  const submit = async (how: (message: string, skills?: string[]) => Promise<boolean>) => {
    // notes before the paths: splitAttachments() only takes the last lines that are paths as attachments
    const message = [text.trim(), ...files.map((a) => a.agentNote), ...files.map((a) => a.agentPath)].filter(Boolean).join('\n');
    const sentText = text;
    const sent = new Set(files.map((a) => a.id));
    const sentSkills = skills;
    setSending(true);
    const ok = await how(message, sentSkills.length ? sentSkills : undefined);
    setSending(false);
    if (ok) {
      setText((str) => (str === sentText ? '' : str));
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
  const steerBlock = files.length > 0 ? t('Réorienter n’accepte pas de pièces jointes')
    : skills.length > 0 ? t('Réorienter n’accepte pas de skill') : steerDisabled;
  const canSteer = Boolean(onSteer) && text.trim() !== '' && !sending && !disabled && !steerBlock;
  const steer = async () => {
    if (!canSteer || !running || !onSteer) return;
    if (await runCommand()) return;
    await submit(onSteer);
  };
  const iconButton = 'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40';

  return (
    <div className={cx('card p-2 pl-2.5 transition-colors focus-within:border-ink-faint', disabled && 'opacity-60')}>
      {queue && queue.items.length > 0 && <QueueList queue={queue} running={running} />}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pb-1 pt-1" aria-label={t('Pièces jointes')}>
          {files.map((a) => <Tile key={a.id} a={a} onRemove={() => remove(a)} />)}
        </ul>
      )}
      {pastedText && files.some((a) => a.id === pastedText.id) && (
        <p data-long-paste className="px-1.5 pb-1 text-[12px] text-ink-soft">
          {t('Texte collé joint en fichier ({n} caractères)', { n: pastedText.text.length.toLocaleString(locale()) })} ·{' '}
          <button type="button" onClick={unpaste} className="font-medium text-accent-ink hover:underline">{t('Remettre en texte')}</button>
        </p>
      )}
      {(skills.length > 0 || autoApprove) && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1 pt-1">
          {autoApprove && (
            <button type="button" data-auto-approve onClick={autoApprove.onOff} title={t('L’agent agit sans demander votre accord. Cliquer pour redemander l’accord.')}
              className="tap-area relative flex items-center gap-1 rounded-full border border-warn/40 bg-warn-soft px-2.5 py-0.5 text-xs text-warn hover:border-warn">
              <ShieldOff className="size-3" strokeWidth={2} /> {t('Sans confirmation')} <X className="size-3" strokeWidth={2} />
            </button>
          )}
          {skills.map((name) => (
            <span key={name} data-skill-pill={name} className="flex items-center gap-1 rounded-full border border-line bg-raised py-0.5 pl-2.5 pr-1 text-xs">
              <Sparkles className="size-3 text-ink-faint" strokeWidth={1.75} /> {t('Skill : ')}<span className="font-mono">{name}</span>
              <button type="button" onClick={() => setSkills(skills.filter((x) => x !== name))} aria-label={t('Retirer le skill {name}', { name })}
                className="tap-area relative flex size-5 items-center justify-center rounded-full text-ink-faint hover:bg-sheet hover:text-ink">
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <SlashMenuLists menus={slash} />
      {failed.length > 0 && (
        <p role="alert" className="px-1.5 pb-1 text-[12px] text-bad">
          {plural(failed.length, 'Pièce jointe non envoyée ({why}). Retirez-la pour envoyer le message.', '{n} pièces jointes non envoyées ({why}). Retirez-les pour envoyer le message.', { why: failed.map((a) => a.error ?? a.name).join(' ; ') })}
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
          if (slash.onMenuKey(e)) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void enter();
          }
        }}
        placeholder={placeholder ?? t('Écrire à l’agent')}
        aria-label="Message"
        aria-controls={slash.listId} aria-activedescendant={slash.activeId}
        className="block max-h-60 min-h-9 w-full resize-none touch:min-h-11 bg-transparent px-1.5 py-1.5 text-[15px] placeholder:text-ink-faint focus:outline-none"
      />
      {commandNote && <p role="status" data-command-note className="px-2 pb-1 text-[12px] text-ink-soft">{commandNote}</p>}
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
              aria-label={t('Joindre des fichiers')}
              title={t('Joindre des fichiers (déposés dans inbox/)')}
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
          <button type="button" onClick={() => void steer()} disabled={!canSteer} aria-label={t('Réorienter')}
            title={steerBlock ?? t('Réorienter : donner ce texte à l’agent tout de suite, après ses outils en cours')}
            className={cx(iconButton, 'text-ink-soft hover:bg-raised hover:text-ink')}>
            <CornerDownRight className="size-4" strokeWidth={1.5} />
          </button>
        )}
        {running && onQueue && (
          <button type="button" onClick={() => void queueOrCommand()} disabled={!canSend} aria-label={t('Mettre en file')}
            title={t('Mettre en file (Entrée) : envoyé à la fin du travail en cours')}
            className={cx(iconButton, 'text-ink-soft hover:bg-raised hover:text-ink')}>
            <ListPlus className="size-4" strokeWidth={1.5} />
          </button>
        )}
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('Arrêter')}
            title={t('Arrêter')}
            className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-line text-ink transition-colors hover:bg-raised"
          >
            <Square className="size-3.5 fill-current" strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enter()}
            disabled={!canSend}
            aria-label={t('Envoyer')}
            title={waiting ? (files.some((a) => a.state === 'failed') ? t('Retirez les pièces jointes en échec') : t('Envoi des pièces jointes…')) : t('Envoyer (Entrée)')}
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
