import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { cx } from '../../components/ui';
import { OFFICE_READ_MAX, readDocx, readPptx, readXlsxSheet, readXlsxSheets, SHEET_ROWS } from './office';
import { readBytes } from './read';
import { locale, t } from '../../i18n';

type Kind = 'docx' | 'xlsx' | 'pptx';

const cell = 'whitespace-pre-wrap border border-line px-2 py-1 align-top';

/** Word, Excel and PowerPoint read in the browser (text, tables, sheets, slides). */
export default function OfficeView({ url, kind, version }: { url: string; kind: Kind; version?: number }) {
  const q = useQuery({
    queryKey: ['file-office', url, version],
    queryFn: async () => {
      const { data } = await readBytes(url, OFFICE_READ_MAX, 'fail');
      if (kind === 'docx') return { kind, blocks: await readDocx(data) } as const;
      if (kind === 'xlsx') return { kind, book: await readXlsxSheets(data) } as const;
      return { kind, slides: await readPptx(data) } as const;
    },
    retry: false,
  });
  if (q.error) return <p className="p-6 text-sm text-ink-soft">{(q.error as Error).message}</p>;
  if (!q.data) return <p className="p-6 text-sm text-ink-faint">{t('Lecture…')}</p>;
  const d = q.data;
  if (d.kind === 'docx') {
    return (
      <div data-viewer="docx" className="space-y-3 px-6 py-5 text-[14px] leading-6">
        {d.blocks.map((b, i) => b.type === 'table' ? (
          <table key={i} className="border-collapse text-[13px]">
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className={cell}>{c}</td>)}</tr>)}</tbody>
          </table>
        ) : b.level ? (
          <p key={i} role="heading" aria-level={b.level} className={cx('font-semibold', b.level === 1 ? 'text-xl' : b.level === 2 ? 'text-lg' : 'text-base')}>
            {b.runs.map((r) => r.text).join('')}
          </p>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {b.runs.map((r, j) => <span key={j} className={cx(r.bold && 'font-semibold', r.italic && 'italic')}>{r.text}</span>)}
          </p>
        ))}
      </div>
    );
  }
  if (d.kind === 'pptx') {
    return (
      <div data-viewer="pptx" className="space-y-3 p-4">
        {d.slides.map((lines, i) => (
          <section key={i} className="rounded-lg border border-line bg-sheet p-4">
            <p className="mb-2 font-mono text-[11px] text-ink-faint">{t('Diapositive {n}', { n: i + 1 })}</p>
            {lines.length ? lines.map((l, j) => <p key={j} className={cx('text-sm', j === 0 && 'font-semibold')}>{l}</p>) : <p className="text-sm text-ink-faint">{t('(sans texte)')}</p>}
          </section>
        ))}
      </div>
    );
  }
  return <Sheets book={d.book} />;
}

function Sheets({ book }: { book: Awaited<ReturnType<typeof readXlsxSheets>> }) {
  const [index, setIndex] = useState(0);
  // only the sheet shown is parsed, again when its tab is clicked
  const { sheet, error } = useMemo(() => {
    try {
      return { sheet: book.sheets.length ? readXlsxSheet(book, index) : null, error: null };
    } catch (e) {
      return { sheet: null, error: (e as Error).message };
    }
  }, [book, index]);
  return (
    <div data-viewer="xlsx">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-4 py-1.5 text-xs">
        {book.sheets.map((s, i) => (
          <button key={i} role="tab" aria-selected={i === index} onClick={() => setIndex(i)}
            className={cx('shrink-0 rounded-md px-2 py-1', i === index ? 'bg-raised text-ink' : 'text-ink-faint hover:text-ink')}>{s.name}</button>
        ))}
      </div>
      {error && <p className="p-6 text-sm text-ink-soft">{error}</p>}
      {sheet && (
        <div className="overflow-auto p-4">
          {sheet.cut && <p className="pb-2 text-xs text-ink-faint">{t('Feuille coupée à {rows} lignes × {cols} colonnes', { rows: SHEET_ROWS.toLocaleString(locale()), cols: 50 })}</p>}
          <table className="border-collapse text-[13px]">
            <tbody>{sheet.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className={cell}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
