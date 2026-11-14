import { ArrowDown, ArrowUp, ListTree } from 'lucide-react';
import { Popover } from '../components/Menu';
import { t } from '../i18n';
import { clock } from './Thread';
import type { OutlineItem } from './turns';

/** Questions needed before « Plan » and the ↑ ↓ buttons show up. */
export const OUTLINE_MIN = 4;

/** « Plan » of the session header: the user's questions, a click goes to one. */
export function TurnPlan({ items, onJump, triggerClass }: { items: OutlineItem[]; onJump: (key: string) => void; triggerClass?: string }) {
  return (
    <Popover
      title={t('Plan de la conversation')} placement="below" align="end" width={380}
      trigger={<ListTree className="size-4" strokeWidth={1.5} />}
      triggerClass={triggerClass ?? 'flex size-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink'}
    >
      {(close) => (
        <ol className="max-h-[60vh]">
          {items.map((it, i) => (
            <li key={it.key}>
              <button
                type="button" role="menuitem"
                onClick={() => { close(); onJump(it.key); }}
                className="flex w-full items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-raised"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[11px] text-ink-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{it.text || t('(sans texte)')}</span>
                {it.ts !== null && <span className="shrink-0 font-mono text-[11px] text-ink-faint">{clock(it.ts)}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </Popover>
  );
}

const ROUND = 'flex size-8 items-center justify-center rounded-full border border-line bg-sheet text-ink-soft shadow-[var(--shadow-card)] transition-colors hover:text-ink';

/** ↑ ↓ above the composer: previous / next question (Alt+↑ / Alt+↓). */
export function TurnJump({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex flex-col gap-1.5" data-turn-jump>
      <button type="button" className={ROUND} onClick={onPrev} aria-label={t('Question précédente')} title={t('Question précédente (Alt ↑)')}>
        <ArrowUp className="size-4" strokeWidth={1.5} />
      </button>
      <button type="button" className={ROUND} onClick={onNext} aria-label={t('Question suivante')} title={t('Question suivante (Alt ↓)')}>
        <ArrowDown className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
