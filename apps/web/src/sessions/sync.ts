import type { QueryClient, QueryKey } from '@tanstack/react-query';

// The page and the side chat's iframe are two copies of the app with their own query cache. When one refreshes its
// sessions lists (after a send, a rename, a deletion…), it tells the other through a BroadcastChannel, which
// refreshes its own. Hooked on invalidateQueries so every existing call site is covered.

const CHANNEL = 'intendia-sync';

/** Lists that show sessions (sidebar, Sessions page, palette, workspaces' counters). */
function isSessionsKey(key: QueryKey | undefined): boolean {
  const head = key?.[0];
  return typeof head === 'string' && (head === 'workspaces' || head === 'session' || head.startsWith('sessions'));
}

export function syncSessions(qc: QueryClient): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  const original = qc.invalidateQueries.bind(qc);
  let timer: ReturnType<typeof setTimeout> | null = null;
  qc.invalidateQueries = ((filters, options) => {
    if (isSessionsKey(filters?.queryKey) && !timer) {
      // several invalidations in a row (send, then the run's end) make one message
      timer = setTimeout(() => { timer = null; channel.postMessage({ type: 'sessions' }); }, 300);
    }
    return original(filters, options);
  }) as QueryClient['invalidateQueries'];
  channel.onmessage = (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type !== 'sessions') return;
    void original({ predicate: (q) => isSessionsKey(q.queryKey) });
  };
  return () => {
    if (timer) clearTimeout(timer);
    channel.close();
    qc.invalidateQueries = original;
  };
}
