// @vitest-environment happy-dom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocx, readPptx, readXlsxSheet, readXlsxSheets, unzipText } from './office';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const zip = (files: Record<string, string>, level: 0 | 6 = 6) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [strToU8(v), { level }]])));
const sync = { sync: true };

describe('docx', () => {
  it('headings, bold / italic runs, tables', async () => {
    const doc = `<w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Rapport</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>gras</w:t></w:r><w:r><w:rPr><w:i/><w:b w:val="0"/></w:rPr><w:t xml:space="preserve"> italique</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const blocks = await readDocx(zip({ 'word/document.xml': doc, 'docProps/app.xml': '<x/>' }), sync);
    expect(blocks).toEqual([
      { type: 'p', level: 1, runs: [{ text: 'Rapport', bold: false, italic: false }] },
      { type: 'p', level: 0, runs: [{ text: 'gras', bold: true, italic: false }, { text: ' italique', bold: false, italic: true }] },
      { type: 'table', rows: [['A1', 'B1']] },
    ]);
  });

  it('not a zip / no document → an error for the owner', async () => {
    await expect(readDocx(strToU8('pas un zip'), sync)).rejects.toThrow('Aperçu impossible');
    await expect(readDocx(zip({ 'a.xml': '<a/>' }), sync)).rejects.toThrow('document Word absent');
    await expect(readDocx(zip({ 'word/document.xml': '<w:document' }), sync)).rejects.toThrow('illisible');
  });
});

describe('xlsx', () => {
  const book = (rows: string) => zip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Ventes" r:id="rId1"/><sheet name="Stock" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Nancy</t></si><si><r><t>Fro</t></r><r><t>uard</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>palettes</t></is></c><c r="B1"><v>12</v></c></row></sheetData></worksheet>',
  });

  it('sheet names, shared strings, inlineStr, numbers, booleans, formulas as stored', async () => {
    const wb = await readXlsxSheets(book('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3"><f>1+1</f><v>2</v></c><c r="B3" t="b"><v>1</v></c></row>'), sync);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Ventes', 'Stock']);
    expect(readXlsxSheet(wb, 0)).toEqual({ rows: [['Nancy', '', 'Frouard'], [], ['2', 'VRAI']], cut: false });
    expect(readXlsxSheet(wb, 1).rows).toEqual([['palettes', '12']]);
  });

  it('cut at 1 000 rows × 50 columns', async () => {
    const wide = Array.from({ length: 60 }, (_, i) => `<c><v>${i}</v></c>`).join('');
    const rows = Array.from({ length: 1005 }, (_, i) => `<row r="${i + 1}">${i === 0 ? wide : '<c r="A1"><v>1</v></c>'}</row>`).join('');
    const sheet = readXlsxSheet(await readXlsxSheets(book(rows), sync), 0);
    expect(sheet.cut).toBe(true);
    expect(sheet.rows).toHaveLength(1000);
    expect(sheet.rows[0]).toHaveLength(50);
  });
});

describe('pptx', () => {
  it('slides in the order of presentation.xml, text per paragraph', async () => {
    const slides = await readPptx(zip({
      'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId3"/><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Deuxième</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Pre</a:t></a:r><a:r><a:t>mière</a:t></a:r></a:p><a:p></a:p><a:p><a:r><a:t>suite</a:t></a:r></a:p></p:sld>',
    }), sync);
    expect(slides).toEqual([['Première', 'suite'], ['Deuxième']]);
  });
});

describe('limits on the real decompressed size', () => {
  const big = 'a'.repeat(3 * 1024 * 1024);
  it('an entry inflating past its limit is stopped, whatever the zip announces', async () => {
    const bytes = zip({ 'word/document.xml': big });
    // the local header announces 10 bytes (uncompressed size, offset 22)
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(22, 10, true);
    await expect(unzipText(bytes, () => true, { ...sync, entryMax: 1024 * 1024 })).rejects.toThrow('contenu trop gros');
  });
  it('the total of the entries read is bounded', async () => {
    const bytes = zip({ 'a.xml': big, 'b.xml': big });
    await expect(unzipText(bytes, () => true, { ...sync, totalMax: 4 * 1024 * 1024 })).rejects.toThrow('contenu trop gros');
    expect((await unzipText(bytes, (n) => n === 'a.xml', { ...sync, totalMax: 4 * 1024 * 1024 })).get('a.xml')).toHaveLength(big.length);
  });
  it('stored entries (no compression) are read too', async () => {
    expect((await unzipText(zip({ 'x.xml': '<x/>' }, 0), () => true, sync)).get('x.xml')).toBe('<x/>');
  });
});
