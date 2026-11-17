// The page shown in the main area, as the layout's tab title, shortcuts and palette need it. One registry: the last
// component that published wins; on unmount (or when its page changes) it removes only its own entry.
import { useEffect, useSyncExternalStore } from 'react';
import type { PaletteItem } from './palette';

export interface ActivePage {
  /** Title of the page (a session's title): the tab title's base. */
  title: string;
  /** « / »: puts the cursor in the page's message field. */
  focusComposer?: () => void;
  /** The palette's « Session ouverte » group. */
  actions: PaletteItem[];
}

let current: ActivePage | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

export function setActivePage(page: ActivePage): void {
  current = page;
  notify();
}

/** Empties the registry only when `page` is still the one published (a newer page stays). */
export function clearActivePage(page: ActivePage): void {
  if (current !== page) return;
  current = null;
  notify();
}

/** For listeners (keys, palette): the page published now. */
export function getActivePage(): ActivePage | null {
  return current;
}

export function subscribeActivePage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Publishes `page` while the component is mounted; null publishes nothing. */
export function useActivePage(page: ActivePage | null): void {
  useEffect(() => {
    if (!page) return;
    setActivePage(page);
    return () => clearActivePage(page);
  }, [page]);
}

/** The page published, re-rendering on each change (the tab title). */
export function useActivePageValue(): ActivePage | null {
  return useSyncExternalStore(subscribeActivePage, getActivePage, getActivePage);
}
