// The run of the session page: starting one (send, its key, a busy session), following it (stream or polling,
// reopened during a run), its end, the queue of messages written meanwhile, reorientation, approvals,
// clarifications and stop.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type ApprovalChoice, type RunStatus } from '../../api';
import { isTerminal, type Approval, type Clarify, type Entry, type RunState } from '../../chat/events';
import { goalKey } from '../../chat/GoalBar';
import {
  clearPendingKey, EMPTY_QUEUE, dropItem, editItem, enqueue, moveItem, firstTime, loadPendingKey, loadQueue, newSendKey, pauseQueue, pushHead, resumeQueue,
  saveQueue, savePendingKey, takeHead, type Queue, type QueueItem,
} from '../../chat/queue';
import { useRun } from '../../chat/useRun';
import type { useChatAvailability } from '../../components/ChatNotice';
import { useApprovals } from '../../components/useApprovals';
import { takeHandoff } from '../../home/handoff';
import { t } from '../../i18n';
import { invalidateSessionLists } from '../UndoBar';

export interface ActiveRun {
  id: string;
  /** seconds; null until the status is known */
  createdAt: number | null;
  /**
   * Largest message id the page knew when it started the run (Hermes' ids grow): the history read during the run is
   * cut there. null = not known (the history was not loaded, or the page was reopened during the run).
   */
  afterId: number | null;
  seed: Entry[];
}

/** A send refused because a run goes on: the session is re-read every 3 s, 30 times at most, for its new run. */
const BUSY_READS = 30;
const BUSY_EVERY_MS = 3_000;
export const codeOf = (err: unknown): string | undefined => (err instanceof ApiError ? (err.data as { code?: string } | null)?.code : undefined);

export const OUTCOME: Record<string, string> = {
  failed: t('Le run a échoué'),
  cancelled: t('Run arrêté'),
  interrupted: t('Run interrompu'),
  error: t('Flux interrompu'),
};

export function useRunControl({ inst, sessionId, active, setActive, lastRun, lastRunId, knownId, forgetOlder, chat, setError }: {
  inst: string | undefined;
  sessionId: string;
  /** the run followed by the page (state of the page: the history's reading depends on it too) */
  active: ActiveRun | null;
  setActive: (run: ActiveRun | null) => void;
  /** status of the session's last run */
  lastRun: RunStatus | undefined;
  lastRunId: string | null;
  knownId: () => number | null;
  forgetOlder: () => void;
  chat: ReturnType<typeof useChatAvailability>;
  setError: (err: unknown) => void;
}) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<{ status: string; error: string | null; input: string | null } | null>(null);
  // a message on its way (before the run is known): the empty session must not change instance meanwhile
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runCount, setRunCount] = useState(0);
  /** Sub-agent trees of the runs that ended on this page (Hermes' history does not keep them). */
  const [trees, setTrees] = useState<Extract<Entry, { kind: 'subagents' }>[]>([]);
  // Messages written during a run (chat/queue.ts): one leaves when a run ends well (`drain`), never on opening the page
  const [queue, setQueue] = useState<Queue>(EMPTY_QUEUE);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [drain, setDrain] = useState<string | null>(null);
  useEffect(() => {
    if (!inst) return;
    setQueue(loadQueue(inst, sessionId));
    setQueueLoaded(true);
  }, [inst, sessionId]);
  useEffect(() => { if (inst && queueLoaded) saveQueue(inst, sessionId, queue); }, [inst, sessionId, queue, queueLoaded]);
  const queued = queue.items.length;
  useEffect(() => {
    if (!queued) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [queued]);

  // Reopened during a run (reload, other tab, network cut, sent from the home page): plug back into its stream.
  // A message sent from the home page is shown at once (handoff), and kept on screen if its run failed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setActive` (a state setter) from the page, stable: same dependencies as when this code was in pages/Session.tsx
  useEffect(() => {
    const s = lastRun;
    if (active || !s || !lastRunId || !inst) return;
    const h = takeHandoff(inst, sessionId, lastRunId);
    const seed: Entry[] = h ? [{ kind: 'user', key: `u-${lastRunId}`, text: h.text, ts: h.ts }] : [];
    if (!isTerminal(s.status)) setActive({ id: lastRunId, createdAt: s.createdAt, afterId: null, seed });
    else if (h && OUTCOME[s.status]) setOutcome({ status: s.status, error: s.error ?? s.output, input: h.text });
    // ended while the page was closed with a reorientation Hermes did not deliver: back in front of the queue, once
    if (isTerminal(s.status) && s.pendingSteer && queueLoaded && firstTime(inst, lastRunId)) {
      setQueue((q) => pauseQueue(pushHead(q, s.pendingSteer!), t('réorientation non livrée')));
    }
  }, [lastRun, lastRunId, active, inst, sessionId, queueLoaded]);

  /** Run being followed, read by onEnd (once per run). */
  const endingRun = useRef<string | null>(null);
  endingRun.current = active?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setActive` (a state setter) from the page, stable: same dependencies as when this code was in pages/Session.tsx
  const onEnd = useCallback(async (state: RunState) => {
    // once per run: a reorientation not delivered goes back in front and waits; a run that did not end well stops the queue
    if (state.pendingSteer) {
      if (firstTime(inst ?? '', endingRun.current ?? '')) setQueue((q) => pauseQueue(pushHead(q, state.pendingSteer!), t('réorientation non livrée')));
    } else if (state.status !== 'completed') setQueue((q) => pauseQueue(q, t('le travail précédent n’a pas abouti')));
    else setDrain(`end-${Date.now()}`);
    const tree = state.entries.find((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents');
    // a truncated replay may lack earlier delegations: the history's cards (all of them) win then
    if (tree && !state.truncated) setTrees((prev) => [...prev, tree]);
    const input = state.entries.find((e): e is Extract<Entry, { kind: 'user' }> => e.kind === 'user' && !e.steer)?.text ?? null;
    setOutcome(OUTCOME[state.status] ? { status: state.status, error: state.error, input } : null);
    // the run's terminal status in its query: a re-read that fails (Hermes unreachable) never follows it again
    qc.setQueryData(['run', inst, sessionId, endingRun.current], (old: RunStatus | undefined) => old && { ...old, status: state.status, error: state.error });
    forgetOlder();
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] }),
      qc.invalidateQueries({ queryKey: ['run', inst, sessionId] }),
      invalidateSessionLists(qc),
    ]);
    // the session list's « En cours » mark goes at once; not awaited: the activity read waits on kanban workers
    void qc.invalidateQueries({ queryKey: ['activity', inst] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    setActive(null);
    setRunCount((n) => n + 1);
    void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
    void qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) });
  }, [qc, inst, sessionId, forgetOlder]);

  const run = useMemo(() => (active ? { id: active.id, seed: active.seed } : null), [active]);
  const [live, localEvent, link] = useRun(inst ?? '', sessionId, inst ? run : null, onEnd);
  const deferred = link.mode === 'polling';
  // followed without a live stream (streams.ts): what waits for an answer comes from the approvals feed, which the
  // global bar hides for the session on screen
  const feed = useApprovals({ enabled: deferred });
  const pendingFeed = deferred && active ? feed.data?.approvals.find((a) => a.sessionId === sessionId && a.runId === active.id) : undefined;
  const approval: Approval | null = live?.approval
    ?? (pendingFeed?.kind === 'approval' ? { requestId: pendingFeed.requestId, command: pendingFeed.command, description: pendingFeed.description, choices: pendingFeed.choices } : null);
  const clarify: Clarify | null = live?.clarify
    ?? (pendingFeed?.kind === 'clarify' ? { requestId: pendingFeed.requestId, question: pendingFeed.question ?? '', choices: pendingFeed.choices, multiSelect: pendingFeed.multiSelect } : null);

  const send = async (text: string, skills?: string[]): Promise<boolean> => (await launch(text, skills)) === null;
  /**
   * A send refused with `run_busy` on its own key (`mine` from the server: the first send of this message still
   * waits for Hermes behind a proxy that answered 502, or its run already started): the session is re-read until its
   * last run changes from the one before that first send (no other run can start meanwhile: the server holds the
   * session), then that run is followed. Busy on another intent (no `mine`): an error, the message was not sent.
   */
  const awaitOwnRun = async (mine: { runId: string | null; lastRunId: string | null }): Promise<boolean> => {
    for (let i = 0; i < BUSY_READS; i++) {
      if (mine.runId === null || i > 0) await new Promise((r) => setTimeout(r, BUSY_EVERY_MS));
      const s = await api.session(inst!, sessionId).catch(() => null);
      if (s && (mine.runId !== null || s.session.lastRunId !== mine.lastRunId)) {
        qc.setQueryData(['session', inst, sessionId], s);
        void qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] });
        return true;
      }
    }
    return false;
  };
  /**
   * Starts a run; the error, or null once started. The message's key (`key`: a queued item's, else the one kept for
   * the same text, else a new one) is kept in the tab until the send succeeded: sending the same text again after a
   * 502, a network cut or a reload never starts a second run.
   */
  const launch = async (text: string, skills?: string[], key?: string): Promise<unknown> => {
    if (!inst) return new Error(t('Instance inconnue'));
    setError(null);
    setOutcome(null);
    setSending(true);
    const kept = loadPendingKey(inst, sessionId);
    const clientKey = key ?? (kept && kept.text === text ? kept.key : newSendKey());
    savePendingKey(inst, sessionId, { text, key: clientKey });
    try {
      const afterId = knownId();
      const res = await api.send(inst, sessionId, text, skills, clientKey);
      clearPendingKey(inst, sessionId);
      // the server paused an active goal (the user writes)
      void qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) });
      const status: RunStatus | null = await api.runStatus(inst, sessionId, res.runId).catch(() => null);
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      setActive({ id: res.runId, createdAt: status?.createdAt ?? null, afterId, seed: [{ kind: 'user', key: `u-${res.runId}`, text, ts: Date.now() / 1000 }] });
      void invalidateSessionLists(qc);
      return null;
    } catch (err) {
      const code = codeOf(err);
      if (code === 'idempotency_conflict' || code === 'already_sent') clearPendingKey(inst, sessionId);
      if (code === 'already_sent') {
        // Hermes already has this message: its answer comes in the conversation, nothing to send again
        void qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] });
        void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
      }
      const mine = code === 'run_busy' ? (err as ApiError).data as { mine?: { runId: string | null; lastRunId: string | null } } | null : null;
      if (mine?.mine) {
        setSending(false);
        // the run of this very send is on its way or started: follow it as soon as the session names it
        if (await awaitOwnRun(mine.mine)) {
          clearPendingKey(inst, sessionId);
          return null;
        }
      }
      setError(err);
      return err;
    } finally {
      setSending(false);
    }
  };

  // the head of the queue leaves once the run is over (and not paused); a refused send puts it back and pauses
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies chosen on purpose (see the comment of this hook)
  useEffect(() => {
    if (active || drain === null || !inst) return;
    setDrain(null);
    if (queue.paused) return;
    const [head, rest] = takeHead(queue);
    if (!head) return;
    setQueue(rest);
    void launch(head.text, head.skills, head.key).then((err) => {
      if (err === null) return;
      // already received by Hermes: its answer comes in the conversation, never sent again
      if (codeOf(err) === 'already_sent') return;
      const reason = err instanceof ApiError && err.status === 409 ? t('un autre onglet a lancé un travail') : t('l’envoi a échoué');
      setQueue((q) => pauseQueue(pushHead(q, head.text, head.skills, head.key), reason));
    });
  }, [active, drain]);

  /** the waiting message being given to the agent (« Envoyer maintenant »), until Hermes answered */
  const [sendingNow, setSendingNow] = useState<string | null>(null);
  const steer = async (text: string): Promise<boolean> => {
    if (!inst || !active) return false;
    setError(null);
    try {
      await api.steer(inst, sessionId, active.id, text);
      localEvent({ event: 'intendia.steer', text, timestamp: Date.now() / 1000 });
      return true;
    } catch (err) {
      setError(err);
      return false;
    }
  };
  const steerDisabled = approval || clarify ? t('Un accord ou une réponse est attendu')
    : !chat.has('chat', 'steer') ? t('Réorientation indisponible sur cette instance')
    : live?.status !== 'running' ? t('L’agent n’a pas encore commencé') : undefined;

  const approve = async (choice: ApprovalChoice) => {
    if (!inst || !active || !approval) return;
    setBusy(true);
    try {
      await api.approve(inst, sessionId, active.id, choice, approval.requestId ?? undefined);
      if (deferred) void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (text: string) => {
    if (!inst || !active || !clarify) return;
    setBusy(true);
    try {
      await api.clarify(inst, sessionId, active.id, text, clarify.requestId ?? undefined);
      if (deferred) void qc.invalidateQueries({ queryKey: ['approvals'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!inst || !active) return;
    await api.stop(inst, sessionId, active.id).catch(setError);
  };

  /** A message written during the run: in the queue. */
  const enqueueMessage = (text: string, sk?: string[]) => setQueue((q) => enqueue(q, text, sk));
  /** The Composer's `queue`: the waiting messages and what can be done with them. */
  const queueProps = {
    items: queue.items, paused: queue.paused,
    onRemove: (id: string) => setQueue((q) => dropItem(q, id)),
    onMove: (id: string, delta: number) => setQueue((q) => moveItem(q, id, delta)),
    onEdit: (id: string, text: string) => setQueue((q) => editItem(q, id, text)),
    // while the agent works: a reorientation (the skills of `/use` only go with a run); else first, sent now
    // one reorientation at a time: a second click never sends the same text twice
    sendNowBlocked: (it: QueueItem) => (sendingNow ? t('Envoi en cours…') : active ? (steerDisabled ?? (it.skills?.length ? t('Avec un skill : attend la fin du travail') : null)) : null),
    onSendNow: (id: string) => {
      const it = queue.items.find((i) => i.id === id);
      if (!it || sendingNow) return;
      if (active) {
        setSendingNow(id);
        void steer(it.text).then((done) => { if (done) setQueue((q) => dropItem(q, id)); }).finally(() => setSendingNow(null));
        return;
      }
      setQueue((q) => resumeQueue(moveItem(q, id, -q.items.length)));
      setDrain(`now-${Date.now()}`);
    },
    onResume: () => { setQueue(resumeQueue); if (!active) setDrain(`resume-${Date.now()}`); },
  };

  return {
    live, link, approval, clarify, outcome, sending, busy, runCount, trees, queued, queueProps, enqueueMessage,
    send, steer, steerDisabled, approve, answer, stop,
  };
}
