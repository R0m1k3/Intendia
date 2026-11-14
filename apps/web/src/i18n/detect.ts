// Language choice, kept apart from the rest so it can be tested without a browser.

export type Lang = 'fr' | 'en';
export type LangSetting = 'auto' | Lang;

/** Stored setting, `auto` for anything else than `fr` / `en`. */
export function parseSetting(v: string | null | undefined): LangSetting {
  return v === 'fr' || v === 'en' ? v : 'auto';
}

/** `auto` = French when one of the browser languages is French, English otherwise. */
export function pickLang(stored: string | null | undefined, navigatorLanguages: readonly string[]): Lang {
  const s = parseSetting(stored);
  if (s !== 'auto') return s;
  return navigatorLanguages.some((l) => l.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}
