// The entries of the thread: the stored history merged with the live run, the sub-agent trees and deliveries,
// the background sub-agents' sessions; the history and the session re-read when tools or the server's wake call
// for it, and « Ne plus attendre ».
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { api, ApiError, type ChatMessage } from '../../api';
import { applyDeliveries, attachChildren, delegationState, pollDelay } from '../../chat/deliveries';
import { historyEntries, mergeHistory, withTrees, type Entry, type RunState } from '../../chat/events';
import { lastTodos } from '../../chat/todos';
import { ask } from '../../components/Dialog';
import { t } from '../../i18n';
import { invalidateSessionLists } from '../UndoBar';
import type { useSessionData } from './useSessionData';
import type { ActiveRun } from './useRunControl';

const REREAD_TOOLS = new Set(['todo_list', 'write_file', 'patch']);

export function useThreadEntries({ inst, sessionId, history, messages, active, live, trees, setError }: {
  inst: string | undefined;
  sessionId: string;
  history: ReturnType<typeof useSessionData>['history'];
  messages: ChatMessage[];
  active: ActiveRun | null;
  live: RunState | null;
  /** sub-agent trees of the runs that ended on this page */
  trees: Extract<Entry, { kind: 'subagents' }>[];
  setError: (err: unknown) => void;
}) {
  const qc = useQueryClient();
  const todos = useMemo(() => lastTodos(messages), [messages]);
  // todo_list, write_file or patch finished during the run: Hermes stored the call first, the history is read again
  // (task list, « Modifiés par l'agent »; last of a burst, 1 s later)
  const doneTodoCalls = live?.entries.filter((e) => e.kind === 'tool' && REREAD_TOOLS.has(e.tool) && e.state !== 'running').length ?? 0;
  const seenTodoCalls = useRef(0);
  useEffect(() => {
    if (doneTodoCalls <= seenTodoCalls.current) { seenTodoCalls.current = doneTodoCalls; return; }
    seenTodoCalls.current = doneTodoCalls;
    const timer = setTimeout(() => void qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] }), 1000);
    return () => clearTimeout(timer);
  }, [doneTodoCalls, qc, inst, sessionId]);
  const openUnits = history.data?.openUnits;
  const delegations = useMemo(() => delegationState(messages, openUnits), [messages, openUnits]);
  // the server's decision on background sub-agents (chat/wake.ts on the server)
  const subagents = history.data?.subagents ?? null;
  const wakePending = Boolean(subagents?.wakePending);
  // the server is about to wake the agent: the session is re-read with the messages, so its new run is followed
  // (the effect on lastRun) as soon as it starts; once more when the wait ends
  useEffect(() => {
    if (!inst) return;
    if (!wakePending) return;
    const id = setInterval(() => void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] }), 3_000);
    return () => { clearInterval(id); void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] }); };
  }, [wakePending, qc, inst, sessionId]);
  // the wake can start between two readings (pending never seen): sub-agents open or a wake expected, then neither
  // (the summary gone, or only kept for a late result of a lost unit) = the delivery was answered; the session is
  // re-read so a run started by the server is followed
  const awaitingSubagents = subagents !== null && (subagents.openTasks > 0 || subagents.wakePending || subagents.capped);
  const hadWaiting = useRef(false);
  useEffect(() => {
    const had = hadWaiting.current;
    hadWaiting.current = awaitingSubagents;
    if (inst && had && !awaitingSubagents) void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
  }, [awaitingSubagents, qc, inst, sessionId]);
  // « Ne plus attendre »: the server gives up the units shown open (a result that still comes is shown and wakes)
  const stopWaiting = async () => {
    if (!inst || !openUnits?.length) return;
    if (!(await ask({
      title: t('Ne plus attendre les sous-agents ?'), confirmLabel: t('Ne plus attendre'),
      message: t('Intendia ne montrera plus ces sous-agents comme en cours. Si d’autres ont déjà livré, l’agent reprend avec leurs résultats. Un résultat qui arrive plus tard s’affichera quand même.'),
    }))) return;
    try {
      await api.stopWaitingSubagents(inst, sessionId, openUnits);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? new Error(t('Un travail est en cours dans cette session : réessayez à sa fin.')) : err);
    }
    await qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] });
    invalidateSessionLists(qc);
  };
  // sessions of the background sub-agents (last activity, tools, end), re-read at the same pace as the history
  const children = useQuery({
    queryKey: ['session-subagents', inst, sessionId], queryFn: () => api.sessionSubagents(inst!, sessionId),
    enabled: Boolean(inst) && delegations.open.size > 0, retry: false, refetchOnWindowFocus: false,
    refetchInterval: () => pollDelay(subagents, Date.now() / 1000),
  });
  // computed on each render, not memoized: the page may add to it the message of a run that failed before starting
  const entries: Entry[] = attachChildren(applyDeliveries(
    withTrees(active && live ? mergeHistory(messages, { createdAt: active.createdAt, afterId: active.afterId }, live.entries) : historyEntries(messages), trees),
    delegations, Boolean(active),
  ), delegations.open.size > 0 ? children.data?.children ?? [] : []);
  return { todos, subagents, entries, stopWaiting };
}
