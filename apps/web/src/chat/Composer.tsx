import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../components/ui';

/** Enter sends, Shift+Enter goes to the next line; while a run goes, the button stops it. */
export function Composer({
  onSend, onStop, running, disabled, placeholder,
}: {
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t || running || sending || disabled) return;
    setSending(true);
    const ok = await onSend(t);
    setSending(false);
    if (ok) setText('');
  };

  return (
    <div className={cx('flex items-end gap-2 rounded-xl border border-line bg-sheet p-2 transition-colors focus-within:border-ink-faint/60', disabled && 'opacity-60')}>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={placeholder ?? 'Écrire à l’agent'}
        aria-label="Message"
        className="max-h-60 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm placeholder:text-ink-faint focus:outline-none"
      />
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
  );
}
