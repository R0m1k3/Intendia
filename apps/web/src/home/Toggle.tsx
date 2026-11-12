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
      className="inline-flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper hover:text-ink"
    >
      <ChevronDown className={cx('size-3.5 transition-transform', !open && '-rotate-90')} strokeWidth={1.5} aria-hidden />
      {open ? 'Réduire' : 'Agrandir'}
    </button>
  );
}
