import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui';

/** Right-hand sheet (portal: the page wrapper is animated, a `fixed` inside it would be relative to it). */
export function Sheet({ title, onClose, children, footer, width = 'md:w-[520px]', onSubmit }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string; onSubmit?: () => void;
}) {
  const Tag = onSubmit ? 'form' : 'div';
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <Tag
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onSubmit={onSubmit ? (e: React.FormEvent) => { e.preventDefault(); onSubmit(); } : undefined}
        className={`enter flex h-full w-full flex-col bg-sheet shadow-xl ${width} md:border-l md:border-line`}
        role="dialog" aria-label={typeof title === 'string' ? title : undefined}
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="min-w-0 text-[15px] font-medium">{title}</h2>
          <Button type="button" variant="ghost" className="size-8 shrink-0 px-0" onClick={onClose} aria-label="Fermer">
            <X className="size-4" strokeWidth={1.5} />
          </Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</footer>}
      </Tag>
    </div>,
    document.body,
  );
}

export const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
export const TEXTAREA = 'w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none';
