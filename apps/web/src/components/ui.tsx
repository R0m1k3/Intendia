import type { ComponentProps, ReactNode } from 'react';
import {
  Bot, CalendarClock, HeartPulse, KanbanSquare, MessagesSquare, Puzzle, ScrollText, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleId, ModuleState } from '../api';
import { showCopy } from './Dialog';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', className, ...p }: ComponentProps<'button'> & { variant?: Variant }) {
  // a px-* given by the caller replaces the default padding (both would be in the class list otherwise)
  const pad = /(^|\s)px-/.test(className ?? '') ? '' : 'px-4';
  return (
    <button
      {...p}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium [&>svg]:shrink-0 transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        pad,
        variant === 'primary' && 'bg-accent text-on-accent hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line bg-sheet text-ink hover:bg-raised',
        variant === 'ghost' && 'text-ink-soft hover:bg-raised hover:text-ink',
        variant === 'danger' && 'border border-line bg-sheet text-bad hover:border-bad/50 hover:bg-bad-soft',
        className,
      )}
    />
  );
}

export function Input({ className, ...p }: ComponentProps<'input'>) {
  return (
    <input
      {...p}
      className={cx(
        'h-9 w-full rounded-lg border border-line bg-sheet px-3 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-accent focus:outline-none',
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Panel({ title, action, children, className, bodyClassName }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cx('card', className)}>
      {(title || action) && (
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClassName ?? 'p-5'}>{children}</div>
    </section>
  );
}

/* State dot: full, half, empty, so the state reads without colour. */
const MARK: Record<ModuleState, { label: string; text: string; box: string }> = {
  full: { label: 'Complet', text: 'text-ok', box: 'border-dot-ok bg-dot-ok shadow-[0_0_0_3px_var(--color-ok-soft)]' },
  readonly: { label: 'Lecture seule', text: 'text-warn', box: 'border-warn bg-[linear-gradient(to_right,var(--color-warn)_50%,transparent_50%)]' },
  unavailable: { label: 'Indisponible', text: 'text-bad', box: 'border-bad' },
};

export function Mark({ state, className }: { state: ModuleState | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-2.5 shrink-0 rounded-full border-[1.5px]',
        state ? MARK[state].box : 'border-ink-faint/50',
        className,
      )}
    />
  );
}

/** Mark + label. `quiet` keeps the label muted when the state is the expected one. */
export function StateMark({ state, quiet = false }: { state: ModuleState; quiet?: boolean }) {
  const m = MARK[state];
  return (
    <span className={cx('inline-flex items-center gap-2 text-xs', quiet && state === 'full' ? 'text-ink-faint' : m.text)}>
      <Mark state={state} />
      {m.label}
    </span>
  );
}

export function worst(states: ModuleState[]): ModuleState {
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('readonly')) return 'readonly';
  return 'full';
}

export const MODULE_META: Record<ModuleId, { icon: LucideIcon; does: string }> = {
  health: { icon: HeartPulse, does: 'Version, santé et capacités' },
  chat: { icon: MessagesSquare, does: 'Conversations avec l’agent' },
  sessions: { icon: ScrollText, does: 'Historique et reprise' },
  crons: { icon: CalendarClock, does: 'Tâches planifiées' },
  skills: { icon: Puzzle, does: 'Skills et toolsets' },
  config: { icon: SlidersHorizontal, does: 'Configuration et modèles' },
  agents: { icon: Bot, does: 'Profils d’agents' },
  kanban: { icon: KanbanSquare, does: 'Tableau de tâches' },
};

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{(error as Error).message}</p>;
}

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className={size === 'lg' ? 'size-8' : 'size-7'} />
      <span className={cx('font-semibold', size === 'lg' ? 'text-lg' : 'text-base')}>Intendia</span>
    </span>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Copies to the clipboard; where the browser refuses (plain http, old browser), shows the text to copy by hand. */
export async function copyText(text: string, label: string): Promise<void> {
  // navigator.clipboard is undefined outside secure contexts (plain http): reading .writeText would throw
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
  } catch {
    await showCopy(label, text);
  }
}

/** A settings section: title and explanation on the left third (≥ 768 px), content on the right; rule above but the first. */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 first:border-t-0 first:pt-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
