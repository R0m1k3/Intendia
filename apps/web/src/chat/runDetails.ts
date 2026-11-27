// « Détails techniques » (Réglages › Affichage, this browser): the line under each answer shows the model, the
// tokens, the rate and the cache share; off by default, it keeps to the duration and the cost.
import { useSyncExternalStore } from 'react';

const KEY = 'intendia-run-details';
const watchers = new Set<() => void>();
const read = (): boolean => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

export function setRunDetails(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
  } catch { /* private mode: the choice lasts for the page */ }
  for (const w of watchers) w();
}

export function useRunDetails(): boolean {
  return useSyncExternalStore((w) => { watchers.add(w); return () => { watchers.delete(w); }; }, read, () => false);
}
