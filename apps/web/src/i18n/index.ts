// Interface language. The key of every text is its French source (`t('Supprimer')`); English lives in `en/<zone>.ts`.
// The language is fixed when the page loads: changing it in Settings reloads the page, so `t()` may be called in
// module-level constants. This file imports nothing from the app (no circular import possible).
import { parseSetting, pickLang, type Lang, type LangSetting } from './detect';

export type { Lang, LangSetting };

declare global {
  interface Window { __i18nMissing?: Set<string> }
}

export const LANG_KEY = 'intendia-lang';
const COOKIE = 'intendia-lang';

const en: Record<string, string> = Object.assign(
  {},
  ...Object.values(import.meta.glob<{ default: Record<string, string> }>('./en/*.ts', { eager: true })).map((m) => m.default),
);

const isTest = import.meta.env.MODE === 'test';
const hasWindow = typeof window !== 'undefined';

function stored(): string | null {
  try { return hasWindow ? window.localStorage.getItem(LANG_KEY) : null; } catch { return null; }
}

let current: Lang = isTest || !hasWindow ? 'fr' : pickLang(stored(), navigator.languages?.length ? navigator.languages : [navigator.language ?? '']);

/** Current language. */
export function getLang(): Lang { return current; }

/** BCP 47 locale for `toLocale*` / `Intl.*`. */
export function locale(): string { return current === 'en' ? 'en-US' : 'fr-FR'; }

/** Setting saved in this browser (`auto` = follow the browser). */
export function langSetting(): LangSetting { return parseSetting(stored()); }

function writeCookie(l: Lang) {
  if (!hasWindow || isTest) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

/** Saves the setting, tells the server (cookie) and reloads the page in the new language. */
export function setLangSetting(v: LangSetting) {
  try {
    if (v === 'auto') window.localStorage.removeItem(LANG_KEY); else window.localStorage.setItem(LANG_KEY, v);
  } catch { /* private mode: the cookie still carries the choice for this visit */ }
  writeCookie(pickLang(v, navigator.languages?.length ? navigator.languages : [navigator.language ?? '']));
  window.location.reload();
}

writeCookie(current);

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Text in the current language; `key` is the French source. `{name}` is replaced by `vars.name`. When one French word
 * has two meanings, the key gets a context after `|` (`'Tableau|vue'`), never shown.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  if (current === 'en') {
    const tr = en[key];
    if (tr !== undefined) return fill(tr, vars);
    if (hasWindow) (window.__i18nMissing ??= new Set()).add(key);
  }
  const bar = key.indexOf('|');
  return fill(bar < 0 ? key : key.slice(0, bar), vars);
}

/** `one` or `other` (both French keys) by the plural rules of the current language; `{n}` is `n` unless given. */
export function plural(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const form = new Intl.PluralRules(locale()).select(n) === 'one' ? one : other;
  return t(form, { n: n.toLocaleString(locale()), ...vars });
}

/** Tests only: switch the language of `t()` / `plural()` / `locale()` (module constants already built do not follow). */
export function __setLangForTest(l: Lang) { current = l; }

/** Tests only: the merged English dictionary. */
export const __en: Readonly<Record<string, string>> = en;
