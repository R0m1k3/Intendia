import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode, type Ref } from 'react';
import { cx } from '../components/ui';

export interface ComposerHandle {
  /** Adds files as attachments (uploaded at once, one tile each); used by paste, the paperclip and the drop zones. */
  addFiles: (files: File[]) => void;
  focus: () => void;
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
 * Enter sends, Shift+Enter goes to the next line; while a run goes, the button stops it.
 * Files (paperclip, paste of a screenshot, drop zones of the page) become tiles above the text: uploaded to inbox/
 * one by one (`upload`), image thumbnails, a state while uploading or after a failure. Their paths are added to the
 * message only when it is sent, one per line after the text: that is how the agent reads them. Sending waits for
 * every tile to be uploaded; a failed tile must be removed first.
 * Bottom bar: `leading` (home page: the workspace) before the paperclip, `hint` (keys) in the middle on wide
 * screens, `options` (session: model, effort) right of it, before the send button.
 */
export function Composer({
  onSend, onStop, running, disabled, placeholder, upload, onAttachmentsChange, leading, options, hint, ref: handle,
}: {
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
  upload?: Upload;
  onAttachmentsChange?: (count: number) => void;
  leading?: ReactNode;
  options?: ReactNode;
  hint?: string;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
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

  useImperativeHandle(handle, () => ({ addFiles, focus: () => ref.current?.focus() }));

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
  const canSend = (text.trim() !== '' || files.length > 0) && !waiting && !sending && !disabled;
  const send = async () => {
    if (!canSend || running) return;
    const message = [text.trim(), ...files.map((a) => a.agentPath)].filter(Boolean).join('\n');
    // what was sent: a file added or text typed while the send is pending stays in the draft
    const sentText = text;
    const sent = new Set(files.map((a) => a.id));
    setSending(true);
    const ok = await onSend(message);
    setSending(false);
    if (ok) {
      setText((t) => (t === sentText ? '' : t));
      for (const a of files) free(a.preview);
      setFiles((all) => all.filter((a) => !sent.has(a.id)));
    }
  };

  return (
    <div className={cx('card p-2 transition-colors focus-within:border-ink-faint/60', disabled && 'opacity-60')}>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pb-1 pt-1" aria-label="Pièces jointes">
          {files.map((a) => <Tile key={a.id} a={a} onRemove={() => remove(a)} />)}
        </ul>
      )}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onPaste={paste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder ?? 'Écrire à l’agent'}
        aria-label="Message"
        className="block max-h-60 min-h-9 w-full resize-none bg-transparent px-2 py-2 text-sm placeholder:text-ink-faint focus:outline-none"
      />
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
            onClick={() => void send()}
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
