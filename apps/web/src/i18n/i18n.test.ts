import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { join } from 'node:path';
// @ts-expect-error plain JS helper shared with the server test
import { listSources, placeholders, scanFiles } from '../../../../scripts/i18n-scan.mjs';
import { __en, __setLangForTest, getLang, plural, t } from './index';
import { pickLang } from './detect';
import { T } from './T';

type Scan = { file: string; keys: { key: string; line: number }[]; bad: { line: number; text: string }[] };

describe('language detection', () => {
  it('follows the browser when automatic', () => {
    expect(pickLang(null, ['fr-CA', 'en'])).toBe('fr');
    expect(pickLang(null, ['de-DE'])).toBe('en');
    expect(pickLang('auto', ['en-US', 'fr'])).toBe('fr');
    expect(pickLang(null, [])).toBe('en');
  });
  it('keeps an explicit choice and ignores an invalid one', () => {
    expect(pickLang('en', ['fr-FR'])).toBe('en');
    expect(pickLang('fr', ['de'])).toBe('fr');
    expect(pickLang('de', ['fr-FR'])).toBe('fr');
  });
  it('is French under the tests', () => { expect(getLang()).toBe('fr'); });
});

describe('t / plural / T', () => {
  it('returns the French source in French, the English text in English, with variables', () => {
    __setLangForTest('fr');
    expect(t('Langue')).toBe('Langue');
    expect(t('Clé inconnue {x}', { x: 1 })).toBe('Clé inconnue 1');
    __setLangForTest('en');
    expect(t('Langue')).toBe('Language');
    expect(t('Clé inconnue {x}', { x: 1 })).toBe('Clé inconnue 1');
    __setLangForTest('fr');
  });
  it('picks the plural form of each language', () => {
    __setLangForTest('fr');
    expect(plural(0, '{n} ligne', '{n} lignes')).toBe('0 ligne');
    expect(plural(2, '{n} ligne', '{n} lignes')).toBe('2 lignes');
    __setLangForTest('en');
    expect(plural(0, '{n} ligne', '{n} lignes')).toBe('0 lines');
    expect(plural(1, '{n} ligne', '{n} lignes')).toBe('1 line');
    __setLangForTest('fr');
  });
  it('puts nodes where the translated sentence wants them', () => {
    __setLangForTest('en');
    expect(t('{a} sur {b}', { a: 1, b: 2 })).toBe('1 of 2');
    const html = renderToStaticMarkup(createElement(T, { k: '{a} sur {b}', vars: { a: createElement('b', null, 'A'), b: createElement('i', null, 'B') } }));
    expect(html).toBe('<b>A</b> of <i>B</i>');
    __setLangForTest('fr');
  });
});

describe('completeness of the English dictionary', () => {
  const scans: Scan[] = scanFiles(listSources(join(__dirname, '..')).filter((f: string) => !f.includes('/src/i18n/')), ['t']);
  const used = new Map<string, string>();
  for (const s of scans) for (const k of s.keys) if (!used.has(k.key)) used.set(k.key, `${s.file}:${k.line}`);

  it('only literal keys', () => {
    const bad = scans.flatMap((s) => s.bad.map((b) => `${s.file}:${b.line} ${b.text}`));
    expect(bad).toEqual([]);
  });
  it('every key has an English text with the same placeholders', () => {
    const problems: string[] = [];
    for (const [k, where] of used) {
      const v = __en[k];
      if (v === undefined) problems.push(`missing: ${JSON.stringify(k)} (${where})`);
      else if (!v.trim()) problems.push(`empty: ${JSON.stringify(k)}`);
      else if (placeholders(k) !== placeholders(v)) problems.push(`placeholders differ: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
      if (/^\s*\{\w+\}\s*$/.test(k)) problems.push(`placeholder-only key: ${JSON.stringify(k)} (${where})`);
    }
    expect(problems).toEqual([]);
  });
  it('no unused English text', () => {
    const own = new Set((scanFiles([__filename], ['t']) as Scan[])[0]!.keys.map((k) => k.key));
    expect(Object.keys(__en).filter((k) => !used.has(k) && !own.has(k))).toEqual([]);
  });
});
