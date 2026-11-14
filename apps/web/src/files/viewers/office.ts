/**
 * Office files (.docx, .xlsx, .pptx) read in the browser for the preview: zip read as a stream (fflate `Unzip`,
 * inflated off the main thread), only the XML parts needed, real decompressed bytes counted whatever the zip
 * announces; XML read by DOMParser. Nothing from the file is ever injected as HTML: the result is plain data.
 */
import { AsyncUnzipInflate, Unzip, UnzipInflate } from 'fflate';
import { t } from '../../i18n';

export const OFFICE_READ_MAX = 20 * 1024 * 1024;
export const ENTRY_MAX = 20 * 1024 * 1024;
export const TOTAL_MAX = 60 * 1024 * 1024;
export const SHEET_ROWS = 1000;
export const SHEET_COLS = 50;

export class PreviewError extends Error {}
const tooBig = () => new PreviewError(t('Aperçu impossible : contenu trop gros'));

/** Tests run without workers: `sync` inflates on the main thread. */
export interface ZipOpts { entryMax?: number; totalMax?: number; sync?: boolean }

/** The wanted entries of a zip, as text. Throws PreviewError past the limits. */
export function unzipText(bytes: Uint8Array, want: (name: string) => boolean, opts: ZipOpts = {}): Promise<Map<string, string>> {
  const entryMax = opts.entryMax ?? ENTRY_MAX;
  const totalMax = opts.totalMax ?? TOTAL_MAX;
  return new Promise((resolve, reject) => {
    const parts = new Map<string, Uint8Array[]>();
    let total = 0;
    let pending = 0;
    let pushed = false;
    let failed = false;
    const live: { terminate: () => void }[] = [];
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      for (const f of live) { try { f.terminate(); } catch { /* already done */ } }
      reject(e);
    };
    const finish = () => {
      if (failed || !pushed || pending) return;
      const dec = new TextDecoder();
      const out = new Map<string, string>();
      for (const [name, chunks] of parts) {
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of chunks) { all.set(c, at); at += c.length; }
        out.set(name, dec.decode(all));
      }
      resolve(out);
    };
    const unzip = new Unzip((file) => {
      if (failed || !want(file.name)) return;
      pending++;
      live.push(file);
      const chunks: Uint8Array[] = [];
      let size = 0;
      file.ondata = (err, data, final) => {
        if (failed) return;
        if (err) { fail(new PreviewError(t('Aperçu impossible : {error}', { error: err.message }))); return; }
        size += data.length;
        total += data.length;
        if (size > entryMax || total > totalMax) { fail(tooBig()); return; }
        chunks.push(data);
        if (final) {
          parts.set(file.name, chunks);
          pending--;
          finish();
        }
      };
      try {
        file.start();
      } catch (e) {
        fail(new PreviewError(t('Aperçu impossible : {error}', { error: (e as Error).message })));
      }
    });
    unzip.register(opts.sync ? UnzipInflate : AsyncUnzipInflate);
    try {
      unzip.push(bytes, true);
    } catch (e) {
      fail(new PreviewError(t('Aperçu impossible : {error}', { error: (e as Error).message })));
    }
    pushed = true;
    finish();
  });
}

function xml(text: string | undefined, what: string): Document {
  if (text === undefined) throw new PreviewError(t('Aperçu impossible : {part} absent', { part: what }));
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new PreviewError(t('Aperçu impossible : {part} illisible', { part: what }));
  return doc;
}

/** Child elements by qualified name (`w:p`), any depth. */
const all = (n: Document | Element, tag: string): Element[] => Array.from(n.getElementsByTagName(tag));
const kids = (n: Element, tag: string): Element[] => Array.from(n.children).filter((c) => c.tagName === tag);
const attr = (n: Element | undefined, name: string) => n?.getAttribute(name) ?? null;
/** OOXML booleans: <w:b/> is on, <w:b w:val="0"/> or "false" is off. */
const on = (n: Element | undefined) => !!n && !['0', 'false', 'off'].includes(attr(n, 'w:val') ?? '');

// ---- Word ----
export interface Run { text: string; bold: boolean; italic: boolean }
export type DocBlock =
  | { type: 'p'; level: number; runs: Run[] }
  | { type: 'table'; rows: string[][] };

function paragraph(p: Element): { level: number; runs: Run[] } {
  const style = attr(kids(p, 'w:pPr')[0]?.getElementsByTagName('w:pStyle')[0], 'w:val') ?? '';
  const m = /^(?:Heading|Titre)([1-6])$/i.exec(style);
  const runs: Run[] = [];
  for (const r of all(p, 'w:r')) {
    const pr = kids(r, 'w:rPr')[0];
    let text = '';
    for (const c of Array.from(r.children)) {
      if (c.tagName === 'w:t') text += c.textContent ?? '';
      else if (c.tagName === 'w:tab') text += '\t';
      else if (c.tagName === 'w:br') text += '\n';
    }
    if (text) runs.push({ text, bold: on(pr?.getElementsByTagName('w:b')[0]), italic: on(pr?.getElementsByTagName('w:i')[0]) });
  }
  return { level: m ? Number(m[1]) : 0, runs };
}

export async function readDocx(bytes: Uint8Array, opts?: ZipOpts): Promise<DocBlock[]> {
  const files = await unzipText(bytes, (n) => n === 'word/document.xml', opts);
  const doc = xml(files.get('word/document.xml'), t('document Word'));
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) return [];
  const out: DocBlock[] = [];
  for (const el of Array.from(body.children)) {
    if (el.tagName === 'w:p') out.push({ type: 'p', ...paragraph(el) });
    else if (el.tagName === 'w:tbl') {
      out.push({
        type: 'table',
        rows: kids(el, 'w:tr').map((tr) => kids(tr, 'w:tc').map((tc) => all(tc, 'w:p').map((p) => paragraph(p).runs.map((r) => r.text).join('')).join('\n'))),
      });
    }
  }
  return out;
}

// ---- Excel ----
export interface Workbook { sheets: { name: string; path: string }[]; shared: string[]; files: Map<string, string> }

export async function readXlsxSheets(bytes: Uint8Array, opts?: ZipOpts): Promise<Workbook> {
  const files = await unzipText(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels'
    || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n), opts);
  const wb = xml(files.get('xl/workbook.xml'), t('classeur Excel'));
  const rels = new Map(all(xml(files.get('xl/_rels/workbook.xml.rels'), t('liens du classeur')), 'Relationship')
    .map((r) => [attr(r, 'Id') ?? '', attr(r, 'Target') ?? '']));
  const sheets = all(wb, 'sheet').map((s) => {
    const target = rels.get(attr(s, 'r:id') ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    return { name: attr(s, 'name') ?? '', path };
  });
  const sst = files.get('xl/sharedStrings.xml');
  const shared = sst === undefined ? [] : all(xml(sst, t('textes partagés')), 'si').map((si) => all(si, 't').map((node) => node.textContent ?? '').join(''));
  return { sheets, shared, files };
}

/** Column letters → index (A → 0, AA → 26). */
const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

/** One sheet, parsed when shown: at most SHEET_ROWS × SHEET_COLS, `cut` when there was more. */
export function readXlsxSheet(wb: Workbook, index: number): { rows: string[][]; cut: boolean } {
  const sheet = wb.sheets[index];
  if (!sheet) throw new PreviewError(t('Aperçu impossible : feuille absente'));
  const doc = xml(wb.files.get(sheet.path), t('feuille {name}', { name: sheet.name }));
  const rows: string[][] = [];
  let cut = false;
  for (const row of all(doc, 'row')) {
    const r = Number(attr(row, 'r') ?? rows.length + 1) - 1;
    if (r >= SHEET_ROWS) { cut = true; break; }
    const cells: string[] = [];
    let next = 0;
    for (const c of kids(row, 'c')) {
      const ref = attr(c, 'r');
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      if (col >= SHEET_COLS) { cut = true; continue; }
      const type = attr(c, 't');
      const v = kids(c, 'v')[0]?.textContent ?? '';
      cells[col] = type === 's' ? wb.shared[Number(v)] ?? ''
        : type === 'inlineStr' ? all(c, 't').map((node) => node.textContent ?? '').join('')
        : type === 'b' ? (v === '1' ? 'VRAI' : 'FAUX')
        : v;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = Array.from(cells, (x) => x ?? '');
  }
  return { rows, cut };
}

// ---- PowerPoint ----
export async function readPptx(bytes: Uint8Array, opts?: ZipOpts): Promise<string[][]> {
  const files = await unzipText(bytes, (n) => n === 'ppt/presentation.xml' || n === 'ppt/_rels/presentation.xml.rels'
    || /^ppt\/slides\/[^/]+\.xml$/.test(n), opts);
  const pres = xml(files.get('ppt/presentation.xml'), t('présentation'));
  const rels = new Map(all(xml(files.get('ppt/_rels/presentation.xml.rels'), t('liens de la présentation')), 'Relationship')
    .map((r) => [attr(r, 'Id') ?? '', attr(r, 'Target') ?? '']));
  return all(pres, 'p:sldId').map((s) => {
    const target = rels.get(attr(s, 'r:id') ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `ppt/${target}`;
    const text = files.get(path);
    if (text === undefined) return [];
    return all(xml(text, t('diapositive')), 'a:p').map((p) => all(p, 'a:t').map((node) => node.textContent ?? '').join('')).filter(Boolean);
  });
}
