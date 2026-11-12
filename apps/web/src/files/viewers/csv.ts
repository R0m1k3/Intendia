/** CSV / TSV for the preview: RFC 4180 (quotes, "" inside quotes, line breaks inside a quoted cell). */

/** `\t` for .tsv; for .csv, `;` when the first line has more `;` than `,` (French Excel export), else `,`. */
export function csvSeparator(name: string, text: string): string {
  if (/\.tsv$/i.test(name)) return '\t';
  // first record only, separators inside quotes not counted
  let semi = 0;
  let comma = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted; // "" inside quotes flips twice: no change
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ';') semi++;
    else if (!quoted && ch === ',') comma++;
  }
  return semi > comma ? ';' : ',';
}

/** At most `maxRows` rows; `total` counts every row of the text (complete or not). */
export function parseCsv(text: string, sep: string, maxRows: number): { rows: string[][]; total: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let total = 0;
  let started = false;
  const endRow = () => {
    row.push(cell);
    total++;
    if (rows.length < maxRows) rows.push(row);
    row = [];
    cell = '';
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; started = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; started = true; continue; }
    if (ch === '\r' && text[i + 1] === '\n') continue;
    if (ch === '\n' || ch === '\r') { endRow(); continue; }
    cell += ch;
    started = true;
  }
  if (started || cell !== '' || row.length) endRow();
  return { rows, total };
}
