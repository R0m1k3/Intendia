import { describe, expect, it } from 'vitest';
import { csvSeparator, parseCsv } from './csv';

describe('csv', () => {
  it('quotes, doubled quotes, separators and line breaks inside quotes', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,"deux\nlignes",3\n', ',', 10)).toEqual({
      rows: [['a', 'b,c', 'd "e"'], ['1', 'deux\nlignes', '3']], total: 2,
    });
  });
  it('separator: tab for .tsv, ; when the first line has more ; than ,', () => {
    expect(csvSeparator('x.tsv', 'a,b')).toBe('\t');
    expect(csvSeparator('x.csv', 'nom;prix;remarque\n"a,b";1,5;x')).toBe(';');
    expect(csvSeparator('x.csv', 'a,b;c,d')).toBe(',');
    expect(parseCsv('a\tb\n', '\t', 5).rows).toEqual([['a', 'b']]);
  });
  it('cut at the row limit, total still counted; empty cells and last line without newline', () => {
    expect(parseCsv('1\n2\n3\n4', ',', 2)).toEqual({ rows: [['1'], ['2']], total: 4 });
    expect(parseCsv('a,,\n', ',', 5).rows).toEqual([['a', '', '']]);
    expect(parseCsv('', ',', 5)).toEqual({ rows: [], total: 0 });
  });
});
