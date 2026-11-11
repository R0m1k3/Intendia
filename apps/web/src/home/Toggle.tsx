import { ChevronDown } from 'lucide-react';
import { cx } from '../components/ui';

/** "Agrandir" / "Réduire" button in the header of a home card. */
export function Toggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-ink-soft transition-colors hover:bg-raised hover:text-ink"
    >
      <ChevronDown className={cx('size-4 transition-transform', !open && '-rotate-90')} strokeWidth={1.5} aria-hidden />
      {open ? 'Réduire' : 'Agrandir'}
    </button>
  );
}
