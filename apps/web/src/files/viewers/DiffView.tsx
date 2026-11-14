import { useQuery } from '@tanstack/react-query';
import { cx } from '../../components/ui';
import { readHead } from './read';
import { t } from '../../i18n';

const READ_MAX = 2 * 1024 * 1024;

const lineClass = (l: string) =>
  /^(diff |--- |\+\+\+ |index )/.test(l) ? 'font-semibold text-ink'
    : l.startsWith('@@') ? 'text-accent-ink'
      : l.startsWith('+') ? 'bg-ok-soft text-ok'
        : l.startsWith('-') ? 'bg-bad-soft text-bad'
          : 'text-ink-soft';

/** A diff / patch with its lines coloured (the first 2 Mio). */
export default function DiffView({ url, version }: { url: string; version?: number }) {
  const q = useQuery({ queryKey: ['file-head', url, version], queryFn: () => readHead(url, READ_MAX) });
  if (q.error) return <p className="p-6 text-sm text-bad">{t('Aperçu impossible : {error}', { error: (q.error as Error).message })}</p>;
  if (!q.data) return null;
  return (
    <div data-viewer="diff" className="py-3 font-mono text-[12.5px] leading-5">
      {q.data.text.split(/\r?\n/).map((l, i) => (
        <div key={i} data-line={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : undefined}
          className={cx('whitespace-pre-wrap break-all px-4', lineClass(l))}>{l || ' '}</div>
      ))}
      {q.data.cut && <p className="px-4 pt-2 font-sans text-xs text-ink-faint">{t('Lecture coupée à 2 Mio')}</p>}
    </div>
  );
}
