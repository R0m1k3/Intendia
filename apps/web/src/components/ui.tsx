import type { ComponentProps, ReactNode } from 'react';
import { Bot, Brain, CalendarClock, GitBranch, HeartPulse, KanbanSquare, LineChart, type LucideIcon, MessagesSquare, Puzzle, ScrollText, SlidersHorizontal } from 'lucide-react';
import type { ModuleId, ModuleState } from '../api';
import { showCopy } from './Dialog';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', className, ...p }: ComponentProps<'button'> & { variant?: Variant }) {
  // a px-* given by the caller replaces the default padding (both would be in the class list otherwise)
  const pad = /(^|\s)px-/.test(className ?? '') ? '' : 'px-3.5';
  return (
    <button
      {...p}
      className={cx(
        'inline-flex h-[34px] items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[13.5px] font-medium [&>svg]:shrink-0 transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        pad,
        variant === 'primary' && 'border border-accent-strong bg-accent text-on-accent hover:bg-accent-strong',
        variant === 'dark' && 'border border-ink bg-ink text-sheet hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-sheet text-ink hover:bg-paper',
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
        'h-9 w-full rounded-lg border border-line bg-sheet px-3 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none',
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
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
        <header className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClassName ?? (title || action ? 'border-t border-line/70 p-4' : 'p-4')}>{children}</div>
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
  git: { icon: GitBranch, does: 'Statut, diff et commits des dépôts des workspaces' },
  monitor: { icon: LineChart, does: 'Utilisation, journaux et métriques du serveur' },
  memory: { icon: Brain, does: 'Mémoire de l’agent et ce qu’il a appris' },
  plugins: { icon: Puzzle, does: 'Plugins d’Hermes : installés et catalogue' },
};

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{(error as Error).message}</p>;
}

/** Black rounded square with an orange I, then the name. */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-[7px] bg-[#0e0e10] font-semibold text-accent dark:ring-1 dark:ring-line', size === 'lg' ? 'size-8 text-[15px]' : 'size-6 text-[13px]')}>I</span>
      <span className={cx('font-semibold', size === 'lg' ? 'text-lg' : 'text-base')}>Intendia</span>
    </span>
  );
}

/** Small mono label on a grey ground (`cron · H1`, `default`, `ok`). */
export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-block whitespace-nowrap rounded px-1.5 py-px font-mono text-[11px] leading-[18px] text-ink-soft bg-raised', className)}>
      {children}
    </span>
  );
}

/** Rounded filter chips; the active one is filled with ink. `role="radiogroup"`, each chip a radio. */
export function Chips<K extends string>({ items, value, onChange, label, className, role = 'radio' }: {
  items: readonly { key: K; label: ReactNode; count?: number }[]; value: K; onChange: (k: K) => void; label: string;
  className?: string; role?: 'radio' | 'tab';
}) {
  return (
    <div role={role === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label} className={cx('flex flex-wrap gap-1.5', className)}>
      {items.map((it) => (
        <button
          key={it.key} type="button" role={role}
          {...(role === 'tab' ? { 'aria-selected': value === it.key } : { 'aria-checked': value === it.key })}
          onClick={() => onChange(it.key)}
          className={chipClass(value === it.key)}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-1.5 font-mono text-[11px] opacity-70">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function chipClass(on: boolean): string {
  return cx(
    'inline-flex h-7 items-center whitespace-nowrap rounded-full border px-2.5 text-[12.5px] transition-colors',
    on ? 'border-ink bg-ink text-sheet' : 'border-line bg-sheet text-ink-soft hover:bg-paper hover:text-ink',
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
    <section className="grid gap-4 border-t border-line py-7 first:border-t-0 first:pt-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
