// What the session page reads from the server: its workspace and session, the agent's skills, the history (with
// the older pages loaded on demand), the cost re-reads, the last run's status, the chat module and the instances.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ChatMessage } from '../../api';
import { useChatAvailability } from '../../components/ChatNotice';
import { agentName, costSettling, COST_POLL_MS } from '../../chat/format';
import { pollDelay } from '../../chat/deliveries';
import { nextCursor, olderOffset } from '../../chat/older-pages';
import { useVaultAvailable } from '../../pages/Access';

export function useSessionData({ slug, sessionId, running, setError }: {
  slug: string;
  sessionId: string;
  /** a run is followed by the page (its stream gives the history meanwhile) */
  running: boolean;
  setError: (err: unknown) => void;
}) {
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const inst = ws.data?.workspace.instanceId;
  const sess = useQuery({ queryKey: ['session', inst, sessionId], queryFn: () => api.session(inst!, sessionId), enabled: Boolean(inst) });
  // activated skills of the session's agent, offered by /use
  const agentProfile = sess.data?.profile ?? 'default';
  // the credential vault can be managed: a browser_vault call that could not ask for a login gets a link to « Accès »
  const vaultOn = useVaultAvailable(inst ?? '') === true;
  const skillList = useQuery({ queryKey: ['skills', inst, agentProfile], queryFn: () => api.skills(inst!, agentProfile).then((r) => r.skills), enabled: Boolean(inst && sess.data), staleTime: 60_000 });
  const skillNames = useMemo(() => (skillList.data ?? []).filter((x) => x.enabled !== false).map((x) => x.name), [skillList.data]);
  const history = useQuery({
    queryKey: ['messages', inst, sessionId], queryFn: () => api.messages(inst!, sessionId),
    enabled: Boolean(inst), refetchOnWindowFocus: false,
    // sub-agents in the background: their result is written later, outside any run (15 s, then 60 s, 24 h at
    // most), then every 3 s until the server's wake starts (the cost is followed by `run-stats`, without messages)
    refetchInterval: (q) => (running ? false : pollDelay(q.state.data?.subagents, Date.now() / 1000)),
  });
  // Hermes writes costs late: the last reply's cost is re-read until the server freezes it, without any message
  const runStatsQ = useQuery({
    queryKey: ['run-stats', inst, sessionId], queryFn: () => api.runStats(inst!, sessionId),
    enabled: Boolean(inst) && !running && costSettling(history.data?.runs), refetchOnWindowFocus: false,
    refetchInterval: (q) => (costSettling(q.state.data?.runs ?? history.data?.runs) ? COST_POLL_MS : false),
  });
  // older pages of the thread (500 messages each, from the end), loaded on demand; forgotten at each run's end and
  // each rewrite (a page read by offset may shift meanwhile)
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  // raw rows read by the older pages (the server's `nextOffset`, hidden rows included): kept apart from the messages
  // shown, so a page of hidden rows only still moves the cursor
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const forgetOlder = useCallback(() => { setOlder([]); setOlderHasMore(null); setOlderCursor(null); }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies(sessionId): the trigger, not read by the effect: it runs again when this changes
  useEffect(() => { forgetOlder(); }, [sessionId, forgetOlder]);
  const lastRunId = sess.data?.session.lastRunId ?? null;
  const lastRun = useQuery({
    queryKey: ['run', inst, sessionId, lastRunId], queryFn: () => api.runStatus(inst!, sessionId, lastRunId!),
    enabled: Boolean(inst && lastRunId), staleTime: 0, refetchOnWindowFocus: false,
  });
  const chat = useChatAvailability(inst);
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const mounts = instances.data?.instances.find((i) => i.id === inst);
  const agent = agentName(sess.data?.profile, mounts?.label);

  // the latest page and the older pages loaded on demand, by id (an offset may overlap: duplicates dropped)
  const latest = history.data?.messages;
  const allMessages = useMemo(() => {
    if (!older.length) return latest ?? [];
    const byId = new Map<number, ChatMessage>();
    for (const m of older) byId.set(m.id, m);
    for (const m of latest ?? []) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }, [older, latest]);
  const messages = allMessages;
  /** Largest message id known (null while the history is not loaded: never 0, an unloaded history is not empty). */
  const knownId = (): number | null => (history.isSuccess ? allMessages.reduce((m, x) => Math.max(m, x.id), 0) : null);
  const hasOlder = olderHasMore ?? Boolean(history.data?.hasMore);
  const loadOlder = async () => {
    if (!inst || !history.data || loadingOlder) return;
    setLoadingOlder(true);
    try {
      // raw rows already read, as Hermes counts them (a page of hidden rows still moves it); new messages meanwhile
      // only make it fall short (duplicates, dropped by id), never skip
      const offset = olderOffset(olderCursor, history.data, older.length);
      const res = await api.messages(inst, sessionId, offset);
      setOlder((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of res.messages) byId.set(m.id, m);
        return [...byId.values()].sort((a, b) => a.id - b.id);
      });
      setOlderHasMore(res.hasMore);
      setOlderCursor(nextCursor(offset, res));
    } catch (err) {
      setError(err);
    } finally {
      setLoadingOlder(false);
    }
  };

  return {
    ws, inst, sess, agentProfile, vaultOn, skillNames, history, runStatsQ, lastRunId, lastRun, chat, instances, mounts, agent,
    messages, knownId, older: { hasOlder, loadingOlder, loadOlder, forget: forgetOlder },
  };
}
