import type { ConfigModels } from '../api';

/**
 * Models Hermes offers to this agent. Rule shared with the server (apps/server/src/chat/models-list.ts
 * `offeredModels`): in the `models` of a provider whose `authenticated` is true; the main model is not added.
 */
export function offered(providers: Pick<ConfigModels['providers'][number], 'authenticated' | 'models'>[]): string[] {
  const out = new Set<string>();
  for (const p of providers) if (p.authenticated === true) for (const m of p.models) out.add(m);
  return [...out];
}

/** Moves item `i` by `delta` places; out of range = unchanged copy. */
export function move<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Catalogue models matching `query` (substring, any case), not already in the list, 20 at most. */
export function candidates(catalog: string[], list: string[], query: string, max = 20): string[] {
  const q = query.trim().toLowerCase();
  const taken = new Set(list);
  return catalog.filter((m) => !taken.has(m) && (!q || m.toLowerCase().includes(q))).slice(0, max);
}
