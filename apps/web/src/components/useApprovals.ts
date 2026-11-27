import { QueryObserver, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api';

type Feed = Awaited<ReturnType<typeof api.approvals>>;

export const APPROVALS_KEY = ['approvals'] as const;
/** Tab on screen: an approval shows up within 5 s. Hidden tab: 10 s is enough for the browser notification and the title. */
export const APPROVALS_VISIBLE_MS = 5_000;
export const APPROVALS_HIDDEN_MS = 10_000;

const fetchApprovals = (): Promise<Feed> => api.approvals();
const pollers = new WeakMap<QueryClient, { users: number; stop: () => void }>();

/**
 * One poll of the approvals (every instance) for the whole tab, however many components read it. Each `useQuery`
 * with a `refetchInterval` runs its own timer: the rail, the tab title, the notification window, the session list
 * and the session each asked on their own. Here a single observer polls for as long as one reader is mounted.
 */
export function watchApprovals(qc: QueryClient): () => void {
  let poller = pollers.get(qc);
  if (!poller) {
    const observer = new QueryObserver(qc, {
      queryKey: APPROVALS_KEY, queryFn: fetchApprovals,
      refetchInterval: () => (typeof document !== 'undefined' && document.visibilityState === 'hidden' ? APPROVALS_HIDDEN_MS : APPROVALS_VISIBLE_MS),
      refetchIntervalInBackground: true, refetchOnWindowFocus: true,
    });
    poller = { users: 0, stop: observer.subscribe(() => {}) };
    pollers.set(qc, poller);
  }
  const mine = poller;
  mine.users += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mine.users -= 1;
    if (mine.users === 0) { mine.stop(); pollers.delete(qc); }
  };
}

/** The approvals waiting on every instance, kept fresh by the shared poll. `enabled: false`: neither read nor polled. */
export function useApprovals({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<Feed> {
  const qc = useQueryClient();
  useEffect(() => (enabled ? watchApprovals(qc) : undefined), [qc, enabled]);
  // no interval here: the data comes from the cache the poller fills
  return useQuery({ queryKey: APPROVALS_KEY, queryFn: fetchApprovals, enabled, staleTime: APPROVALS_VISIBLE_MS });
}
