import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from './ui';
import { t } from '../i18n';

/**
 * In-app dialogs replacing the browser's confirm() / prompt(): `ask()` and `askText()` return a promise, the
 * <DialogHost/> mounted once at the root draws them. Escape or a click outside cancels, Enter confirms.
 */
interface Common { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string }
export interface AskOptions extends Common { danger?: boolean }
export interface AskTextOptions extends Common { label?: string; value?: string; maxLength?: number; placeholder?: string }
export interface AskChoiceOptions extends Common { label?: string; options: { value: string; label: string }[] }

type Request =
  | { kind: 'ask'; opts: AskOptions; resolve: (v: boolean) => void }
  | { kind: 'text'; opts: AskTextOptions; resolve: (v: string | null) => void }
  | { kind: 'choice'; opts: AskChoiceOptions; resolve: (v: string | null) => void }
  | { kind: 'copy'; opts: Common & { text: string }; resolve: () => void };

let show: ((r: Request) => void) | null = null;

/** Yes / no question; resolves false when cancelled (or when no host is mounted). */
export function ask(opts: AskOptions): Promise<boolean> {
  return new Promise((resolve) => (show ? show({ kind: 'ask', opts, resolve }) : resolve(false)));
}

/** One-line text; resolves the trimmed text, or null when cancelled or empty. */
export function askText(opts: AskTextOptions): Promise<string | null> {
  return new Promise((resolve) => (show ? show({ kind: 'text', opts, resolve }) : resolve(null)));
}

/** One choice among `options` (radio buttons); resolves its value, or null when cancelled. */
export function askChoice(opts: AskChoiceOptions): Promise<string | null> {
  return new Promise((resolve) => (show ? show({ kind: 'choice', opts, resolve }) : resolve(null)));
}

/** Shows a text to copy by hand (the browser refused the clipboard). */
export function showCopy(title: string, text: string): Promise<void> {
  return new Promise((resolve) => (show ? show({ kind: 'copy', opts: { title, text }, resolve }) : resolve()));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    show = (r) => setQueue((q) => [...q, r]);
    return () => { show = null; };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const done = () => setQueue((q) => q.slice(1));
  return <DialogView key={queue.length + current.opts.title} req={current} done={done} />;
}

function DialogView({ req, done }: { req: Request; done: () => void }) {
  const [text, setText] = useState(req.kind === 'text' ? req.opts.value ?? '' : req.kind === 'copy' ? req.opts.text : req.kind === 'choice' ? req.opts.options[0]?.value ?? '' : '');
  const input = useRef<HTMLInputElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(document.activeElement);

  const finish = (confirmed: boolean) => {
    if (req.kind === 'ask') req.resolve(confirmed);
    else if (req.kind === 'text') req.resolve(confirmed && text.trim() ? text.trim() : null);
    else if (req.kind === 'choice') req.resolve(confirmed && text ? text : null);
    else req.resolve();
    done();
    // after the effect cleanup has lifted `inert` (an inert element cannot take focus)
    setTimeout(() => (before.current as HTMLElement | null)?.focus?.(), 0);
  };

  useEffect(() => {
    // the page behind is inert (no Tab, no click) while the dialog is open; the dialog is portalled outside #root
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    if (input.current) { input.current.focus(); input.current.select(); } else ok.current?.focus();
    // capture on window: runs before the page's own shortcuts (Ctrl/Cmd K), which are swallowed
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); root?.removeAttribute('inert'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { title, message } = req.opts;
  const danger = req.kind === 'ask' && req.opts.danger;
  const confirmLabel = req.opts.confirmLabel ?? (req.kind === 'copy' ? t('Fermer') : t('Confirmer'));
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/25 px-3 pt-[18vh]" onMouseDown={() => finish(false)}>
      <form
        role={req.kind === 'ask' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); finish(true); }}
        className="enter w-full max-w-[440px] rounded-xl border border-line bg-sheet p-5 shadow-[var(--shadow-card)]"
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {message && <div className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</div>}
        {req.kind === 'choice' && (
          <fieldset className="mt-4">
            {req.opts.label && <legend className="mb-2 text-sm font-medium">{req.opts.label}</legend>}
            <div className="max-h-[40vh] space-y-1 overflow-y-auto">
              {req.opts.options.map((o) => (
                <label key={o.value} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-raised">
                  <input type="radio" name="choice" value={o.value} checked={text === o.value} onChange={() => setText(o.value)} className="accent-accent" />
                  <span className="truncate">{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {(req.kind === 'text' || req.kind === 'copy') && (
          <label className="mt-4 block">
            {req.kind === 'text' && req.opts.label && <span className="mb-2 block text-sm font-medium">{req.opts.label}</span>}
            <Input
              ref={input} value={text} readOnly={req.kind === 'copy'} onChange={(e) => setText(e.target.value)}
              maxLength={req.kind === 'text' ? req.opts.maxLength : undefined}
              placeholder={req.kind === 'text' ? req.opts.placeholder : undefined}
              aria-label={req.kind === 'text' ? req.opts.label ?? title : title}
              className={req.kind === 'copy' ? 'font-mono text-xs' : undefined}
            />
          </label>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {req.kind !== 'copy' && <Button type="button" variant="ghost" onClick={() => finish(false)}>{req.opts.cancelLabel ?? t('Annuler')}</Button>}
          <Button
            ref={ok} type="submit" variant={danger ? 'danger' : 'primary'}
            disabled={(req.kind === 'text' && !text.trim()) || (req.kind === 'choice' && !text)}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
