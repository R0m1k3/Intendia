import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './ui';
import { t } from '../i18n';

/**
 * List + detail (the mockup's inbox layout). From 768 px: a sticky list column with its own scroll, the detail
 * flowing in `main` (the only element that scrolls the page). Phones: the list alone, or the detail alone once
 * something is selected in the address (`selected`).
 */
export function SplitView({ list, children, selected, listHidden = false, label, phoneBoth = false }: {
  list: ReactNode; children: ReactNode; selected: boolean; label?: string;
  /** true: no list column; 'narrow': none below 1280 px (the session page, whose chat needs the width). */
  listHidden?: boolean | 'narrow';
  /** Phones: the detail then the list below it (home page). */
  phoneBoth?: boolean;
}) {
  return (
    <div className={cx('flex min-h-[var(--content-h)] items-stretch', phoneBoth && 'max-md:flex-col-reverse max-md:justify-end')}>
      <aside
        aria-label={label}
        data-list-pane=""
        className={cx(
          'w-full min-w-0 shrink-0 border-line md:sticky md:top-0 md:h-[var(--content-h)] md:w-[clamp(300px,28vw,400px)] md:overflow-y-auto md:border-r',
          selected && !phoneBoth && 'max-md:hidden',
          listHidden === true && 'md:hidden',
          listHidden === 'narrow' && 'md:max-xl:hidden',
          phoneBoth && 'max-md:border-t',
        )}
      >
        {list}
      </aside>
      <div data-detail-pane="" className={cx('min-w-0 flex-1', !selected && !phoneBoth && 'max-md:hidden')}>{children}</div>
    </div>
  );
}

/** The list column: title (18 px), an action, optional search / filters, then the items. */
export function ListPane({ title, action, head, children, footer }: {
  title: ReactNode; action?: ReactNode; head?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-2.5 border-b border-line/70 px-4 pb-2.5 pt-3.5">
        <div className="flex min-h-[34px] items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {action}
        </div>
        {head}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 px-2 pb-4 pt-1.5">{children}</div>
      {footer}
    </div>
  );
}

/** Day or section label inside a list column. */
export function ListLabel({ children }: { children: ReactNode }) {
  return <p className="px-3.5 pb-1 pt-3.5 text-xs text-ink-faint">{children}</p>;
}

export function listItemClass(selected: boolean, className?: string): string {
  return cx(
    'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 rounded-[10px] px-3.5 py-3 text-left transition-colors',
    selected ? 'bg-accent-soft' : 'hover:bg-paper',
    className,
  );
}

/** The content of a list item: title, meta (mono, right), then sub-line and tag. */
export function ListItemBody({ title, meta, sub, tag, mono = false }: {
  title: ReactNode; meta?: ReactNode; sub?: ReactNode; tag?: ReactNode; mono?: boolean;
}) {
  return (
    <>
      <span className={cx('truncate font-medium', mono && 'font-mono text-[13.5px]')}>{title}</span>
      <span className="justify-self-end font-mono text-[11.5px] text-ink-faint">{meta}</span>
      <span className={cx('truncate text-[13px] text-ink-soft', !tag && 'col-span-2')}>{sub}</span>
      {tag && <span className="justify-self-end">{tag}</span>}
    </>
  );
}

type LinkLike = { to: string; params?: Record<string, string>; search?: Record<string, unknown>; hash?: string };

/** A list item that is a link (the selection lives in the address). */
export function ListLink({ link, selected, className, children, ...rest }: {
  link: LinkLike; selected: boolean; className?: string; children: ReactNode;
} & Omit<ComponentProps<'a'>, 'href' | 'children'>) {
  return (
    <Link
      {...(link as { to: string })}
      {...rest}
      aria-current={selected ? 'true' : undefined}
      className={listItemClass(selected, className)}
    >
      {children}
    </Link>
  );
}

/** Detail header (64 px): title, a mono line of facts, actions; a back link to the list on phones. */
export function DetailHeader({ title, meta, actions, back, sticky = false, mono = false, sub }: {
  title: ReactNode; meta?: ReactNode; actions?: ReactNode; back?: LinkLike; sticky?: boolean; mono?: boolean; sub?: ReactNode;
}) {
  return (
    <header className={cx(
      'flex min-h-16 flex-wrap items-center gap-2 border-b border-line/70 bg-sheet px-4 py-3 md:px-6',
      sticky && 'sticky top-0 z-20',
    )}>
      {back && (
        <Link {...(back as { to: string })} aria-label={t('Revenir à la liste')} className="-ml-1 grid size-[34px] place-items-center rounded-lg text-ink-soft hover:bg-raised md:hidden">
          <ArrowLeft className="size-4" strokeWidth={1.5} />
        </Link>
      )}
      <div className="min-w-0 flex-[1_1_260px]">
        <h2 className={cx('truncate text-lg font-semibold leading-snug', mono && 'font-mono text-[17px]')}>{title}</h2>
        {meta && <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">{meta}</p>}
        {sub && <p className="mt-0.5 text-[13px] text-ink-faint">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Detail body: padded column, 860 px reading width. */
export function DetailBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex max-w-[860px] flex-col gap-5 px-4 py-6 md:px-6', className)}>{children}</div>;
}

/** Facts grid (the mockup's `dl.kv`). */
export function Facts({ items }: { items: { label: string; value: ReactNode; mono?: boolean; className?: string }[] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-ink-faint">{it.label}</dt>
          <dd className={cx('mt-0.5 break-words', it.mono && 'font-mono text-[13px]', it.className)}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Empty state of a detail or a full page: icon tile on orange-pale, title, text, actions. */
export function Empty({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-16 text-center">
      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-accent-soft text-ink [&>svg]:size-5">{icon}</span>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <p className="max-w-[46ch] text-ink-faint">{children}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
