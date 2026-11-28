import { CircleHelp } from 'lucide-react';
import { term, type TermId } from '../help/glossary';
import { t } from '../i18n';
import { Popover } from './Menu';

/**
 * A small « ? » next to a word of the trade: one click shows what it means (help/glossary.ts) and leads to the
 * Aide page. Keyboard: Tab then Enter; Escape closes.
 */
export function Hint({ id, className }: { id: TermId; className?: string }) {
  const g = term(id);
  return (
    <Popover
      title={t('Que veut dire « {term} » ?', { term: g.term })} placement="below" align="start" width={320}
      triggerClass={`tap-area relative inline-grid size-5 shrink-0 place-items-center rounded-full align-middle text-ink-faint hover:bg-raised hover:text-ink ${className ?? ''}`}
      trigger={<CircleHelp className="size-3.5" strokeWidth={1.75} aria-hidden />}
    >
      {() => (
        <div className="px-2.5 py-2 text-left text-sm font-normal normal-case tracking-normal text-ink" data-hint={id}>
          <p className="font-semibold">{g.term}</p>
          <p className="mt-1 text-ink-soft">{g.text}</p>
          <a href={`/aide#${g.id}`} className="mt-2 inline-block text-[13px] font-medium underline underline-offset-2">{t('Tous les mots expliqués')}</a>
        </div>
      )}
    </Popover>
  );
}
