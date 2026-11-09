import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { ModuleState } from '../api';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-paper hover:opacity-90',
        variant === 'secondary' && 'border border-line bg-sheet hover:border-ink-faint',
        variant === 'ghost' && 'text-ink-soft hover:bg-line/50 hover:text-ink',
        variant === 'danger' && 'border border-line bg-sheet text-bad hover:border-bad',
        className,
      )}
    />
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cx(
        'h-9 w-full rounded-md border border-line bg-sheet px-3 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none',
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-sheet', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const STATE: Record<ModuleState, { label: string; cls: string; dot: string }> = {
  full: { label: 'Complet', cls: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  readonly: { label: 'Lecture seule', cls: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  unavailable: { label: 'Indisponible', cls: 'bg-bad-soft text-bad', dot: 'bg-bad' },
};

export function StateBadge({ state }: { state: ModuleState }) {
  const s = STATE[state];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium', s.cls)}>
      <span className={cx('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{(error as Error).message}</p>;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
