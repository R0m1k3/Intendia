// Unread sessions of the agents column: a session is unread when it moved since it was last open in this browser.
// Kept in localStorage per instance: `base` = first visit (anything older counts as read), `seen` = id → activity
// time (ms) when it was last open. Pure helpers + a small hook.

import { useCallback, useEffect, useState } from 'react';

export interface SeenState { base: number; seen: Record<string, number> }

/** Kept entries per instance: the oldest go first. */
export const SEEN_MAX = 500;

const key = (inst: string) => `intendia-seen:${inst}`;

export function readSeen(raw: string | null, now: number): SeenState {
  try {
    const v = raw ? JSON.parse(raw) as Partial<SeenState> : null;
    if (v && typeof v.base === 'number' && v.seen && typeof v.seen === 'object') return { base: v.base, seen: v.seen };
  } catch { /* fresh state */ }
  return { base: now, seen: {} };
}

export function isUnread(state: SeenState, s: { id: string; at: number }): boolean {
  return s.at > Math.max(state.base, state.seen[s.id] ?? 0);
}

/** The state after opening session `id` whose activity is `at`; null when nothing changes. */
export function markSeen(state: SeenState, id: string, at: number): SeenState | null {
  if ((state.seen[id] ?? 0) >= at) return null;
  const entries = Object.entries({ ...state.seen, [id]: at }).sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX);
  return { base: state.base, seen: Object.fromEntries(entries) };
}

const listeners = new Set<() => void>();

/** Unread marks of an instance, shared by every component of the tab (and other tabs through `storage`). */
export function useSeen(inst: string | null): { isUnread: (s: { id: string; at: number }) => boolean; seen: (id: string, at: number) => void } {
  const load = useCallback(() => (inst ? readSeen(localStorage.getItem(key(inst)), Date.now()) : { base: 0, seen: {} }), [inst]);
  const [state, setState] = useState<SeenState>(load);
  useEffect(() => {
    const fresh = load();
    setState(fresh);
    // first visit: the base is written once, so a reload does not move it
    if (inst && !localStorage.getItem(key(inst))) localStorage.setItem(key(inst), JSON.stringify(fresh));
    const reload = () => setState(load());
    listeners.add(reload);
    const onStorage = (e: StorageEvent) => { if (inst && e.key === key(inst)) reload(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(reload); window.removeEventListener('storage', onStorage); };
  }, [inst, load]);
  const seen = useCallback((id: string, at: number) => {
    if (!inst) return;
    const next = markSeen(readSeen(localStorage.getItem(key(inst)), Date.now()), id, at);
    if (!next) return;
    localStorage.setItem(key(inst), JSON.stringify(next));
    for (const l of listeners) l();
  }, [inst]);
  return { isUnread: useCallback((s) => isUnread(state, s), [state]), seen };
}
