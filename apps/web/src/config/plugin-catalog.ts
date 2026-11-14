import type { PluginCatalogEntry } from '../api';
import { plural, t } from '../i18n';

export type TierFilter = 'tous' | 'official' | 'verified' | 'community';
export const TIER_LABEL: Record<string, string> = { official: t('Officiel'), verified: t('Vérifié'), community: t('Communauté') };
/** The catalog holds about a thousand entries: only the first ones of a search are drawn. */
export const SHOWN = 40;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Entries matching every word of the query (name, title, description, maintainer, category), official first. */
export function filterCatalog(entries: PluginCatalogEntry[], query: string, tier: TierFilter): PluginCatalogEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const rank = (e: PluginCatalogEntry) => (e.tier === 'official' ? 0 : e.tier === 'verified' ? 1 : 2);
  return entries
    .filter((e) => tier === 'tous' || e.tier === tier)
    .filter((e) => {
      const hay = fold([e.name, e.title, e.description, e.maintainer ?? '', e.category ?? ''].join(' '));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** What the plugin adds to Hermes, in words ("2 outils : a, b · 1 hook : x"), or null when it declares nothing. */
export function capabilityLines(e: PluginCatalogEntry): string[] {
  const n = (list: string[]) => list.length;
  const names = (list: string[]) => ({ list: list.join(', ') });
  return [
    e.tools.length ? plural(n(e.tools), '{n} outil : {list}', '{n} outils : {list}', names(e.tools)) : null,
    e.hooks.length ? plural(n(e.hooks), '{n} hook (appelé à chaque message ou outil) : {list}', '{n} hooks (appelés à chaque message ou outil) : {list}', names(e.hooks)) : null,
    e.middleware.length ? plural(n(e.middleware), '{n} middleware : {list}', '{n} middlewares : {list}', names(e.middleware)) : null,
    e.requiresEnv.length ? plural(n(e.requiresEnv), '{n} variable requise : {list}', '{n} variables requises : {list}', names(e.requiresEnv)) : null,
  ].filter((x): x is string => x !== null);
}
