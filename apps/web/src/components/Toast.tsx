// Short confirmations at the bottom of the screen (« Enregistré », « Copié ») and failures of actions that have no
// place of their own to show an error. One call from anywhere: toast('Enregistré'); a mutation asks for it with
// `meta: { done: t('Enregistré') }` (success) or `meta: { fail: true }` (failure, explained) — see main.tsx.
import { Check, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { explain } from '../errors/explain';
import { t } from '../i18n';

export interface ToastItem { id: number; text: string; kind: 'ok' | 'bad'; sub?: string }

const OK_MS = 3500;
const BAD_MS = 9000;
/** At most this many at once: the oldest leaves. */
const MAX = 3;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<(list: ToastItem[]) => void>();
const emit = () => { for (const l of listeners) l(items); };

export function dismissToast(id: number): void {
  items = items.filter((i) => i.id !== id);
  emit();
}

/** Shows a confirmation; the same text already on screen is not repeated (its delay starts again). */
export function toast(text: string, opts: { kind?: 'ok' | 'bad'; sub?: string } = {}): number {
  const kind = opts.kind ?? 'ok';
  items = items.filter((i) => !(i.text === text && i.kind === kind));
  const id = ++seq;
  items = [...items, { id, text, kind, sub: opts.sub }].slice(-MAX);
  emit();
  setTimeout(() => dismissToast(id), kind === 'ok' ? OK_MS : BAD_MS);
  return id;
}

/** A failed action, explained (what happened, what to do). */
export function toastError(error: unknown): number {
  const e = explain(error);
  return toast(e.text, { kind: 'bad', sub: e.todo });
}

/** For tests. */
export function __toasts(): ToastItem[] { return items; }
export function __resetToasts(): void { items = []; emit(); }

/** Mounted once (Layout): above the phone's bottom bar, at the bottom centre on wide screens. */
export function Toasts() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-3 md:bottom-6" aria-live="polite" data-toasts>
      {list.map((i) => (
        <div key={i.id} role={i.kind === 'bad' ? 'alert' : 'status'}
          className={`enter pointer-events-auto flex max-w-[min(92vw,30rem)] items-start gap-2.5 rounded-xl border bg-sheet py-2.5 pl-3 pr-2 text-sm shadow-[var(--shadow-card)] ${i.kind === 'bad' ? 'border-bad/40' : 'border-line'}`}>
          {i.kind === 'bad'
            ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" strokeWidth={1.75} />
            : <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2} />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{i.text}</p>
            {i.sub && <p className="mt-0.5 text-[13px] text-ink-soft">{i.sub}</p>}
          </div>
          <button type="button" onClick={() => dismissToast(i.id)} aria-label={t('Fermer')} className="grid size-6 shrink-0 place-items-center rounded-md text-ink-faint hover:bg-raised hover:text-ink">
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
