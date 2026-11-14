import { useMemo } from 'react';
import { cx } from '../components/ui';
import { changed, diffLines, hunks } from './diff';
import { plural, t } from '../i18n';

/** Line diff of two texts, changed lines with three lines of context. */
export function DiffView({ before, after, empty }: { before: string; after: string; empty?: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const parts = useMemo(() => hunks(lines), [lines]);
  if (changed(lines) === 0) return <p className="text-sm text-ink-soft">{empty ?? t('Aucune différence.')}</p>;
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-line bg-paper font-mono text-[12px] leading-relaxed">
      {parts.map((h, i) => ('skipped' in h ? (
        <div key={i} className="border-y border-line/60 bg-raised/50 px-3 py-0.5 text-ink-faint">… {plural(h.skipped, '{n} ligne identique', '{n} lignes identiques', { n: h.skipped })}</div>
      ) : (
        <div key={i}>
          {h.lines.map((l, j) => (
            <div key={j} className={cx('whitespace-pre-wrap break-all px-3',
              l.kind === 'add' && 'bg-ok-soft text-ink', l.kind === 'del' && 'bg-bad-soft text-ink', l.kind === 'same' && 'text-ink-soft')}>
              <span className="mr-2 select-none text-ink-faint">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>{l.text || ' '}
            </div>
          ))}
        </div>
      )))}
    </div>
  );
}
