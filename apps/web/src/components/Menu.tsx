import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './ui';

/**
 * A button opening a floating panel. The panel is portalled to <body>: inside the page, `position: fixed` would be
 * relative to the animated `.enter` container (it has a transform), not to the screen. Closed by Escape (focus back
 * on the button), a click outside or a resize; on opening, focus goes to the checked item, else the first item.
 */
export function Popover({ trigger, title, placement = 'above', align = 'start', width = 320, disabled, triggerClass, children }: {
  trigger: ReactNode;
  /** Accessible name of the button and of the panel. */
  title: string;
  placement?: 'above' | 'below';
  align?: 'start' | 'end';
  /** Max width of the panel, px. */
  width?: number;
  disabled?: boolean;
  triggerClass?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = align === 'start' ? Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) : Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    setPos(placement === 'above'
      ? { left, width: w, bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(160, r.top - 16) }
      : { left, width: w, top: r.bottom + 6, maxHeight: Math.max(160, window.innerHeight - r.bottom - 16) });
  }, [open, placement, align, width]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    (panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)'))?.focus();
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open, pos]);

  const close = () => { setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button
        ref={btn} type="button" disabled={disabled} title={title} aria-label={typeof trigger === 'string' ? undefined : title}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={triggerClass}
      >
        {trigger}
      </button>
      {open && pos && createPortal(
        <div
          ref={panel} role="menu" aria-label={title} style={pos}
          className="fixed z-50 overflow-y-auto rounded-xl border border-line bg-sheet p-1 shadow-[var(--shadow-card)]"
        >
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}

export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; icon?: ReactNode }

/** Action menu ("…"): one button per item. */
export function Menu({ title, items, trigger, triggerClass, placement = 'below', align = 'end' }: {
  title: string; items: MenuItem[]; trigger: ReactNode; triggerClass?: string; placement?: 'above' | 'below'; align?: 'start' | 'end';
}) {
  return (
    <Popover title={title} trigger={trigger} triggerClass={triggerClass} placement={placement} align={align} width={224}>
      {(close) => items.map((it) => (
        <button
          key={it.label} type="button" role="menuitem" disabled={it.disabled}
          onClick={() => { close(); it.onSelect(); }}
          className={cx(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised focus:bg-raised focus:outline-none disabled:opacity-50 disabled:hover:bg-transparent',
            it.danger && 'text-bad',
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </Popover>
  );
}

export interface PickerChoice { value: string | null; label: string; hint?: string; mono?: boolean }
/** An action shown after the choices (e.g. "Gérer les modèles…"): no value, never checked. */
export interface PickerAction { action: () => void; label: string }
export type PickerItem = PickerChoice | PickerAction;

const PICKER_BTN = 'flex h-7 max-w-[14rem] min-w-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 aria-expanded:bg-raised';

/** A text button opening a list of choices (one checked). */
export function Picker({ label, title, items, value, disabled, onPick, placement = 'above', triggerClass }: {
  label: ReactNode; title: string; items: PickerItem[]; value: string | null; disabled?: boolean; onPick: (v: string | null) => void;
  placement?: 'above' | 'below'; triggerClass?: string;
}) {
  return (
    <Popover
      title={title} disabled={disabled} placement={placement} triggerClass={triggerClass ?? PICKER_BTN}
      trigger={<><span className="truncate">{label}</span><ChevronDown className="size-3 shrink-0" strokeWidth={1.75} /></>}
    >
      {(close) => items.map((it, i) => 'action' in it ? (
        <button
          key={`action:${it.label}`} type="button" role="menuitem" onClick={() => { close(); it.action(); }}
          className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-soft hover:bg-raised hover:text-ink focus:bg-raised focus:outline-none',
            i > 0 && !('action' in items[i - 1]!) && 'mt-1 border-t border-line')}
        >
          <span className="size-3.5 shrink-0" />
          {it.label}
        </button>
      ) : (
        <button
          key={it.value ?? 'auto'} type="button" role="menuitemradio" aria-checked={it.value === value}
          onClick={() => { close(); if (it.value !== value) onPick(it.value); }}
          className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised focus:bg-raised focus:outline-none"
        >
          <Check className={cx('mt-0.5 size-3.5 shrink-0 text-accent', it.value !== value && 'invisible')} strokeWidth={2} />
          <span className="min-w-0">
            <span className={cx('block truncate', it.mono && 'font-mono text-[13px]')}>{it.label}</span>
            {it.hint && <span className="block text-xs text-ink-faint">{it.hint}</span>}
          </span>
        </button>
      ))}
    </Popover>
  );
}
