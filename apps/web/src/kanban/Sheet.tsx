import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { confirmClose } from '../components/dirty';
import { Button } from '../components/ui';
import { t } from '../i18n';

/** Open sheets, newest last: only the top one answers Escape. */
const stack: symbol[] = [];

/**
 * Right-hand sheet (portal: the page wrapper is animated, a `fixed` inside it would be relative to it), above the mobile bar (z-50).
 * The backdrop (a mouse down on it, not a text selection released over it), the X and Escape close it through
 * `confirmClose`: a modified screen inside asks first. `data-overlay` marks it for the page shortcuts.
 */
export function Sheet({ title, onClose, children, footer, width = 'md:w-[520px]', onSubmit }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string; onSubmit?: () => void;
}) {
  const Tag = onSubmit ? 'form' : 'div';
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const requestClose = () => void confirmClose(() => closeRef.current());
  useEffect(() => {
    const me = Symbol('sheet');
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || stack.at(-1) !== me) return;
      e.preventDefault();
      void confirmClose(() => closeRef.current());
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(me), 1);
    };
  }, []);
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes the sheet; the keyboard has Escape (see the effect above)
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a click on the backdrop closes the sheet; the keyboard has Escape (see the effect above)
    <div
      data-overlay className="fixed inset-0 z-[55] flex justify-end bg-ink/20"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <Tag
        onSubmit={onSubmit ? (e: React.FormEvent) => { e.preventDefault(); onSubmit(); } : undefined}
        className={`enter flex h-full w-full flex-col bg-sheet shadow-xl ${width} md:border-l md:border-line`}
        role="dialog" aria-label={typeof title === 'string' ? title : undefined}
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 text-[15px] font-medium">{title}</h2>
          <Button type="button" variant="ghost" className="size-8 shrink-0 px-0" onClick={requestClose} aria-label={t('Fermer')}>
            <X className="size-4" strokeWidth={1.5} />
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-4">{footer}</footer>}
      </Tag>
    </div>,
    document.body,
  );
}

export const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
export const TEXTAREA = 'w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none';
