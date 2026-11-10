import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode, type Ref } from 'react';
import { cx } from '../components/ui';

export interface ComposerHandle {
  /** Appends lines (file paths) to the message being written. */
  append: (lines: string[]) => void;
}

/**
 * Enter sends, Shift+Enter goes to the next line; while a run goes, the button stops it.
 * The paperclip uploads files to inbox/ (onAttach) and adds their paths to the message; so does pasting
 * a file or a screenshot (Ctrl+V), which gets a dated name since the clipboard calls every image image.png.
 * `options` (model, effort) sit in the bottom bar, left of the send button.
 */
export function Composer({
  onSend, onStop, running, disabled, placeholder, onAttach, options, ref: handle,
}: {
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
  onAttach?: (files: File[]) => void;
  options?: ReactNode;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useImperativeHandle(handle, () => ({
    append: (lines) => {
      setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')}\n` : '') + lines.join('\n'));
      ref.current?.focus();
    },
  }), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttach || disabled) return;
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    onAttach(files.map((f, i) => new File([f], pastedName(f, i, files.length), { type: f.type })));
  };

  const send = async () => {
    const t = text.trim();
    if (!t || running || sending || disabled) return;
    setSending(true);
    const ok = await onSend(t);
    setSending(false);
    if (ok) setText('');
  };

  return (
    <div className={cx('rounded-xl border border-line bg-sheet p-2 transition-colors focus-within:border-ink-faint/60', disabled && 'opacity-60')}>
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
        {onAttach && (
          <>
            <input ref={picker} type="file" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onAttach(f); }} />
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
        <div className="min-w-0 flex-1">{options}</div>
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
            disabled={!text.trim() || sending || disabled}
            aria-label="Envoyer"
            title="Envoyer (Entrée)"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-40"
          >
            <ArrowUp className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
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
