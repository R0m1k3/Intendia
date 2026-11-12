import { useQuery } from '@tanstack/react-query';
import { csvSeparator, parseCsv } from './csv';
import { readHead } from './read';

const READ_MAX = 2 * 1024 * 1024;
const ROWS_MAX = 1000;
const COLS_MAX = 50;

/** CSV / TSV as a table: the first 2 Mio, 1 000 rows at most. */
export default function CsvView({ url, name, version }: { url: string; name: string; version?: number }) {
  const q = useQuery({
    queryKey: ['file-head', url, version],
    queryFn: async () => {
      const { text, cut } = await readHead(url, READ_MAX);
      return { ...parseCsv(text, csvSeparator(name, text), ROWS_MAX), cut };
    },
  });
  if (q.error) return <p className="p-6 text-sm text-bad">Aperçu impossible : {(q.error as Error).message}</p>;
  if (!q.data) return null;
  const { rows, total, cut } = q.data;
  const [head, ...body] = rows.map((r) => r.slice(0, COLS_MAX));
  const wide = rows.some((r) => r.length > COLS_MAX);
  const note = cut ? `au moins ${total.toLocaleString('fr-FR')} lignes (lecture coupée à 2 Mio)` : `${total.toLocaleString('fr-FR')} ligne${total > 1 ? 's' : ''}`;
  return (
    <div data-viewer="csv">
      <p className="px-4 pt-3 text-xs text-ink-faint">
        {total > ROWS_MAX ? `1 000 premières lignes sur ${note}` : note}{wide ? ` ; ${COLS_MAX} premières colonnes` : ''}
      </p>
      <div className="overflow-auto p-4">
        <table className="border-collapse text-[13px]">
          {head && (
            <thead>
              <tr>{head.map((c, i) => <th key={i} className="sticky top-0 border border-line bg-paper px-2 py-1 text-left font-medium">{c}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className="whitespace-pre-wrap border border-line px-2 py-1 align-top">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
