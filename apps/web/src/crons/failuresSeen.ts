// Failed planifications already seen: the red badge of « Planning » (and of the instance) counts only the failures you
// have not looked at yet. Opening the Planning page marks the current ones as seen; a new failed run (another
// `lastRunAt`) shows the badge again. The page itself keeps showing every failure in red.
// Kept in localStorage: instance → cron (`profile/id`: an id is unique only within a profile) → `lastRunAt` of the failed run seen. Pure helpers + a small hook.

import { useCallback, useEffect, useState } from 'react';
import { cronKey } from '../components/selection';
import { FAILED } from '../home/summary';

export type FailuresSeen = Record<string, Record<string, string>>;

interface FailingCron { id: string; profile: string; lastRunAt: string | null; lastStatus: string | null }

const KEY = 'intendia-failures-seen';

export function readFailuresSeen(raw: string | null): FailuresSeen {
  try {
    const v = raw ? JSON.parse(raw) as unknown : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as FailuresSeen;
  } catch { /* fresh state */ }
  return {};
}

const failing = (crons: FailingCron[]) => crons.filter((c) => FAILED.has(c.lastStatus ?? ''));

/** Crons of `inst` whose last run failed and was not seen yet. */
export function unseenFailures(seen: FailuresSeen, inst: string, crons: FailingCron[]): number {
  const mine = seen[inst] ?? {};
  return failing(crons).filter((c) => mine[cronKey(c)] !== (c.lastRunAt ?? '')).length;
}

/** The state once every current failure of `inst` is seen (only failing crons are kept); null when nothing changes. */
export function markFailuresSeen(seen: FailuresSeen, inst: string, crons: FailingCron[]): FailuresSeen | null {
  const next = Object.fromEntries(failing(crons).map((c) => [cronKey(c), c.lastRunAt ?? '']));
  const before = seen[inst] ?? {};
  const same = Object.keys(next).length === Object.keys(before).length && Object.entries(next).every(([id, at]) => before[id] === at);
  return same ? null : { ...seen, [inst]: next };
}

const listeners = new Set<() => void>();
const load = () => readFailuresSeen(localStorage.getItem(KEY));

/** Seen failures, shared by every component of the tab (and other tabs through `storage`). */
export function useFailuresSeen(): {
  unseen: (inst: string, crons: FailingCron[]) => number;
  markSeen: (inst: string, crons: FailingCron[]) => void;
} {
  const [state, setState] = useState<FailuresSeen>(load);
  useEffect(() => {
    const reload = () => setState(load());
    listeners.add(reload);
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) reload(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(reload); window.removeEventListener('storage', onStorage); };
  }, []);
  const markSeen = useCallback((inst: string, crons: FailingCron[]) => {
    const next = markFailuresSeen(load(), inst, crons);
    if (!next) return;
    localStorage.setItem(KEY, JSON.stringify(next));
    for (const l of listeners) l();
  }, []);
  return { unseen: useCallback((inst, crons) => unseenFailures(state, inst, crons), [state]), markSeen };
}
