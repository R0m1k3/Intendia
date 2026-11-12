import type { PluginCatalogEntry } from '../api';

export type TierFilter = 'tous' | 'official' | 'verified' | 'community';
export const TIER_LABEL: Record<string, string> = { official: 'Officiel', verified: 'Vérifié', community: 'Communauté' };
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
  const part = (list: string[], one: string, many: string) => (list.length ? `${list.length} ${list.length > 1 ? many : one} : ${list.join(', ')}` : null);
  return [
    part(e.tools, 'outil', 'outils'), part(e.hooks, 'hook (appelé à chaque message ou outil)', 'hooks (appelés à chaque message ou outil)'),
    part(e.middleware, 'middleware', 'middlewares'), part(e.requiresEnv, 'variable requise', 'variables requises'),
  ].filter((x): x is string => x !== null);
}
