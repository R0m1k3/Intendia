// Language of the texts shown to users. The server always works in French (`msg()` returns French, stored texts stay
// French whoever triggered them); the output middleware translates the fields of TEXT_FIELDS when the browser asked
// for English (cookie `intendia-lang`, set by the web, else Accept-Language). See docs/architecture.md.
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import en from './en.js';

export type Lang = 'fr' | 'en';

/** Names of the JSON fields whose string values are texts for the user (also inside arrays and nested objects). */
export const TEXT_FIELDS = new Set([
  'error', 'message', 'reason', 'reasons', 'note', 'notice', 'detail', 'lastError', 'warning', 'modelError',
  'pushError', 'checkError', 'blockReason', 'notes', 'reasonDetail',
]);

/**
 * Fields holding user data or identifiers (session titles, MCP server names, file names): never translated, except
 * these placeholders written by Intendia itself when the data is empty.
 */
export const EXACT_FIELDS = new Set(['title', 'name']);
const PLACEHOLDERS = new Set([msg('Session sans titre'), msg('Nouvelle session'), msg('(sans nom)')]);

/** French text with `{name}` replaced; the first argument is also the key of the English dictionary. */
export function msg(fr: string, vars?: Record<string, string | number | null | undefined>): string {
  if (!vars) return fr;
  return fr.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m));
}

/** Language asked by the request: cookie fr|en, else Accept-Language (French if it has fr*, English otherwise), else fr. */
export function requestLang(c: Context): Lang {
  const cookie = getCookie(c, 'intendia-lang');
  if (cookie === 'fr' || cookie === 'en') return cookie;
  const header = c.req.header('accept-language');
  if (!header || !header.trim()) return 'fr';
  const langs = header.split(',').map((p) => p.trim()).filter((p) => p && !/;\s*q=0(\.0*)?\s*$/i.test(p));
  return langs.some((p) => p.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Pattern { re: RegExp; names: string[]; fixed: number; en: string }

/** Translator over one dictionary (exported for the tests; the app uses `toLang`). */
export function makeTranslator(dict: Record<string, string>): (text: string) => string | null {
  const patterns: Pattern[] = [];
  for (const [fr, tr] of Object.entries(dict)) {
    if (!/\{\w+\}/.test(fr)) continue;
    const names: string[] = [];
    const parts = fr.split(/\{(\w+)\}/g);
    let src = '';
    parts.forEach((p, i) => {
      if (i % 2 === 0) src += escape(p);
      else { names.push(p); src += '([\\s\\S]+?)'; }
    });
    patterns.push({ re: new RegExp(`^${src}$`), names, fixed: parts.filter((_, i) => i % 2 === 0).join('').length, en: tr });
  }
  // nested: the value captured by a pattern, translated once more (Intendia message inside a message, list of words)
  const inner = (v: string): string => {
    const one = match(v, (x) => x);
    if (one !== null) return one;
    if (v.includes(', ')) return v.split(', ').map((x) => dict[x] ?? x).join(', ');
    return v;
  };
  function match(text: string, sub: (v: string) => string): string | null {
    const exact = dict[text];
    if (exact !== undefined) return exact;
    let best: { p: Pattern; m: RegExpExecArray } | null = null;
    for (const p of patterns) {
      const m = p.re.exec(text);
      if (m && (!best || p.fixed > best.p.fixed)) best = { p, m };
    }
    if (!best) return null;
    const { p, m } = best;
    return p.en.replace(/\{(\w+)\}/g, (all, k: string) => {
      const i = p.names.indexOf(k);
      return i >= 0 ? sub(m[i + 1]!) : all;
    });
  }
  return (text) => match(text, inner);
}

let translator: ((text: string) => string | null) | null = null;

/** Text in the asked language: French texts of Intendia are found back (variables too); anything else is unchanged. */
export function toLang(text: string, lang: Lang): string {
  if (lang !== 'en' || !text) return text;
  translator ??= makeTranslator(en);
  return translator(text) ?? text;
}

/** Translates in place the TEXT_FIELDS strings of a JSON value. */
export function translateJson(v: unknown, lang: Lang, mode: 'no' | 'text' | 'exact' = 'no'): unknown {
  if (typeof v === 'string') {
    if (mode === 'text') return toLang(v, lang);
    if (mode === 'exact' && lang === 'en' && PLACEHOLDERS.has(v)) return (en as Record<string, string>)[v] ?? v;
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => translateJson(x, lang, mode));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = translateJson(x, lang, TEXT_FIELDS.has(k) ? 'text' : EXACT_FIELDS.has(k) && typeof x === 'string' ? 'exact' : 'no');
    return out;
  }
  return v;
}

const MAX = 2_000_000;

/** Output middleware: translates the JSON answers (not raw files) for an English browser. */
export function translateResponses(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const lang = requestLang(c);
    if (lang !== 'en') return;
    const res = c.res;
    if (!(res.headers.get('content-type') ?? '').startsWith('application/json')) return;
    if (res.headers.has('content-disposition')) return;
    if (Number(res.headers.get('content-length') ?? 0) > MAX) return;
    let text: string;
    try { text = await res.clone().text(); } catch { return; }
    if (text.length > MAX) return;
    let data: unknown;
    try { data = JSON.parse(text); } catch { return; }
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    const out = new Response(JSON.stringify(translateJson(data, lang)), { status: res.status, statusText: res.statusText, headers });
    c.res = undefined;
    c.res = out;
  };
}
