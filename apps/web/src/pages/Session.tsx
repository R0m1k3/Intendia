import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Archive, ArchiveRestore, ArrowLeft, Check, Clock, Copy, Download, Ellipsis, Eraser, Link2, Maximize2, Minimize2, PanelRight, Pencil, Pin, PinOff, ShieldCheck, ShieldOff, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { SESSION_LIST_KEYS, showUndo, invalidateSessionLists } from '../sessions/UndoBar';
import { download, newKey, useCopyOps } from '../sessions/copies';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, rawUrl, type ApprovalChoice, type Effort, type RunStat, type RunStatus } from '../api';
import { historyEntries, isTerminal, mergeHistory, withTrees, type Approval, type Clarify, type Entry, type RunState } from '../chat/events';
import { EMBEDDED, forgetSideSession, setSideSession } from '../chat/embed';
import { Composer, type ComposerHandle, type ExtractArchive, type Upload } from '../chat/Composer';
import { sessionDraftKey } from '../chat/draft';
import { ContextGauge } from '../chat/ContextGauge';
import { estimateTokens } from '../chat/estimate';
import { agentName, shortModel, costSettling, COST_POLL_MS, placeRunStats } from '../chat/format';
import { applyDeliveries, attachChildren, delegationState, pollDelay } from '../chat/deliveries';
import { measure, startFollow, type FollowState } from '../chat/follow';
import { EMPTY_QUEUE, dropItem, enqueue, firstTime, loadQueue, pauseQueue, pushHead, resumeQueue, saveQueue, takeHead, type Queue } from '../chat/queue';
import { RunOptions } from '../chat/RunOptions';
import { AGENT_INDENT, ApprovalCard, ThinkingIndicator, Thread, type ThreadActions } from '../chat/Thread';
import { stamps } from '../chat/timeline';
import { artifactPaths } from '../chat/artifacts';
import { lastTodos } from '../chat/todos';
import { writtenPaths } from '../chat/written';
import { Todos } from '../chat/Todos';
import { OUTLINE_MIN, TurnJump, TurnPlan } from '../chat/TurnNav';
import { outline } from '../chat/turns';
import { useStoredFlag } from '../components/useStoredFlag';
import { ClarifyCard } from '../chat/ClarifyCard';
import { useColumn, useOpenSession } from '../chat/column-context';
import { useRun } from '../chat/useRun';
import { ChatNotice, useChatAvailability } from '../components/ChatNotice';
import { SessionFiles } from '../components/SessionFiles';
import { DropZone } from '../files/DropZone';
import { FilePaths, type FilePathsValue } from '../files/FilePaths';
import { findPathCandidates } from '../files/paths';
import { splitAttachments } from '../chat/attachments';
import { Preview } from '../files/Preview';
import { uploadFiles } from '../files/upload';
import { setDraft, setHandoff, takeDraft, takeHandoff } from '../home/handoff';
import { ACTION_LABEL, cutFor, lastUser, type HistoryAction } from '../chat/history-actions';
import { COMMANDS, type Command, type CommandName } from '../chat/commands';
import { formatTokens } from '../chat/format';
import { Menu, Picker } from '../components/Menu';
import { Button, copyText, cx, ErrorText } from '../components/ui';
import { ask, askText } from '../components/Dialog';
import { GoalBar, goalKey, useGoal } from '../chat/GoalBar';
import { SubagentsBar } from '../chat/SubagentsBar';
import { GoalDialog } from '../chat/GoalDialog';
import type { GoalSettings } from '../api';
import { workspaceScope } from '../files/scope';

const REREAD_TOOLS = new Set(['todo_list', 'write_file', 'patch']);
import { useInbox } from '../sessions/InboxLayout';

/** Bordered 34 px icon button of the session header (the mockup's `.btn.ib`). */
export const ICON_BTN = 'grid size-[34px] shrink-0 place-items-center rounded-lg border border-line bg-sheet text-ink transition-colors hover:bg-paper';

/** Session date in the header: "16:21" today, else "2 nov. 16:21" (ms). */
export function when(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${time}`;
}

/** "Plein écran": hides the inbox column (kept in this browser); only from 1280 px, where the column shows. */
export function FullScreen() {
  const { full, setFull } = useInbox();
  return (
    <button
      type="button" onClick={() => setFull(!full)} aria-pressed={full}
      className={cx(
        'hidden h-[34px] items-center gap-2 rounded-lg border px-3.5 text-[13.5px] font-medium transition-colors xl:inline-flex',
        full ? 'border-line bg-sheet text-ink hover:bg-paper' : 'border-accent-strong bg-accent text-on-accent hover:bg-accent-strong',
      )}
    >
      {full ? <Minimize2 className="size-4" strokeWidth={1.5} /> : <Maximize2 className="size-4" strokeWidth={1.5} />}
      {full ? 'Afficher la liste' : 'Plein écran'}
    </button>
  );
}

/** In a column of the Chat page, the thread scrolls in its own element (its panel stays beside it, outside). */
function Scroller({ inColumn, children }: { inColumn: boolean; children: ReactNode }) {
  return inColumn ? <div data-scroll-root className="min-w-0 flex-1 overflow-y-auto">{children}</div> : <>{children}</>;
}

interface ActiveRun {
  id: string;
  /** seconds; null until the status is known */
  createdAt: number | null;
  seed: Entry[];
}

const OUTCOME: Record<string, string> = {
  failed: 'Le run a échoué',
  cancelled: 'Run arrêté',
  interrupted: 'Run interrompu',
  error: 'Flux interrompu',
};

/**
 * The route reuses the page when another session is opened from the sidebar: a key remounts it so the
 * run state (active run, outcome, draft) never leaks from one session to the next.
 */
export function SessionPage() {
  const { slug, sessionId } = useParams({ strict: false }) as { slug: string; sessionId: string };
  return <SessionView key={`${slug}/${sessionId}`} slug={slug} sessionId={sessionId} />;
}

export function SessionView({ slug, sessionId }: { slug: string; sessionId: string }) {
  const qc = useQueryClient();
  const col = useColumn();
  const goTo = useOpenSession();
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const inst = ws.data?.workspace.instanceId;
  const sess = useQuery({ queryKey: ['session', inst, sessionId], queryFn: () => api.session(inst!, sessionId), enabled: Boolean(inst) });
  // activated skills of the session's agent, offered by /use
  const agentProfile = sess.data?.profile ?? 'default';
  const skillList = useQuery({ queryKey: ['skills', inst, agentProfile], queryFn: () => api.skills(inst!, agentProfile).then((r) => r.skills), enabled: Boolean(inst && sess.data), staleTime: 60_000 });
  const skillNames = useMemo(() => (skillList.data ?? []).filter((x) => x.enabled !== false).map((x) => x.name), [skillList.data]);
  // why the last run went without its personality (shown under the composer until the next send)
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveRun | null>(null);
  const history = useQuery({
    queryKey: ['messages', inst, sessionId], queryFn: () => api.messages(inst!, sessionId),
    enabled: Boolean(inst), refetchOnWindowFocus: false,
    // Hermes writes costs late: the last reply's cost is re-read until the server freezes it
    refetchInterval: (q) => {
      if (active) return false;
      if (costSettling(q.state.data?.runs)) return COST_POLL_MS;
      // sub-agents in the background: their result is written later, outside any run (15 s, then 60 s, 24 h at
      // most), then every 3 s until the server's wake starts
      return pollDelay(q.state.data?.subagents, Date.now() / 1000);
    },
  });
  const lastRunId = sess.data?.session.lastRunId ?? null;
  const lastRun = useQuery({
    queryKey: ['run', inst, sessionId, lastRunId], queryFn: () => api.runStatus(inst!, sessionId, lastRunId!),
    enabled: Boolean(inst && lastRunId), staleTime: 0, refetchOnWindowFocus: false,
  });
  const [outcome, setOutcome] = useState<{ status: string; error: string | null; input: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const chat = useChatAvailability(inst);
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const mounts = instances.data?.instances.find((i) => i.id === inst);
  const agent = agentName(sess.data?.profile, mounts?.label);
  // closed at first: the inbox column takes the room; opening it (or a preview) moves the column aside
  const [panel, setPanel] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const inbox = useInbox();
  const sideOpen = panel || previewPath !== null;
  const { setPanelOpen } = inbox;
  useEffect(() => { setPanelOpen(sessionId, sideOpen); }, [sessionId, sideOpen, setPanelOpen]);
  useEffect(() => () => setPanelOpen(sessionId, false), [sessionId, setPanelOpen]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [runCount, setRunCount] = useState(0);
  /** Sub-agent trees of the runs that ended on this page (Hermes' history does not keep them). */
  const [trees, setTrees] = useState<Extract<Entry, { kind: 'subagents' }>[]>([]);
  const composer = useRef<ComposerHandle>(null);
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
  useEffect(() => {
    const s = lastRun.data;
    if (active || !s || !lastRunId || !inst) return;
    const h = takeHandoff(inst, sessionId, lastRunId);
    const seed: Entry[] = h ? [{ kind: 'user', key: `u-${lastRunId}`, text: h.text, ts: h.ts }] : [];
    if (!isTerminal(s.status)) setActive({ id: lastRunId, createdAt: s.createdAt, seed });
    else if (h && OUTCOME[s.status]) setOutcome({ status: s.status, error: s.error ?? s.output, input: h.text });
    // ended while the page was closed with a reorientation Hermes did not deliver: back in front of the queue, once
    if (isTerminal(s.status) && s.pendingSteer && queueLoaded && firstTime(inst, lastRunId)) {
      setQueue((q) => pauseQueue(pushHead(q, s.pendingSteer!), 'réorientation non livrée'));
    }
  }, [lastRun.data, lastRunId, active, inst, sessionId, queueLoaded]);
  // the last workspace used is the home page's starting choice
  // (in the Chat page, only the active column: the others are not « the session opened last »)
  const leading = !col || col.active;
  useEffect(() => { if (leading) localStorage.setItem('intendia-last-workspace', slug); }, [slug, leading]);
  // the last session opened is the one the side chat (⌘J) shows
  const found = Boolean(sess.data);
  useEffect(() => { if (inst && found && leading) setSideSession(inst, { slug, id: sessionId }); }, [inst, found, slug, sessionId, leading]);
  // in the side chat, the cursor goes to the message field
  useEffect(() => { if (EMBEDDED) composer.current?.focus(); }, [found]);

  /** Run being followed, read by onEnd (once per run). */
  const endingRun = useRef<string | null>(null);
  endingRun.current = active?.id ?? null;
  const onEnd = useCallback(async (state: RunState) => {
    // once per run: a reorientation not delivered goes back in front and waits; a run that did not end well stops the queue
    if (state.pendingSteer) {
      if (firstTime(inst ?? '', endingRun.current ?? '')) setQueue((q) => pauseQueue(pushHead(q, state.pendingSteer!), 'réorientation non livrée'));
    } else if (state.status !== 'completed') setQueue((q) => pauseQueue(q, 'le travail précédent n’a pas abouti'));
    else setDrain(`end-${Date.now()}`);
    const tree = state.entries.find((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents');
    // a truncated replay may lack earlier delegations: the history's cards (all of them) win then
    if (tree && !state.truncated) setTrees((t) => [...t, tree]);
    const input = state.entries.find((e): e is Extract<Entry, { kind: 'user' }> => e.kind === 'user' && !e.steer)?.text ?? null;
    setOutcome(OUTCOME[state.status] ? { status: state.status, error: state.error, input } : null);
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
  }, [qc, inst, sessionId]);

  const run = useMemo(() => (active ? { id: active.id, seed: active.seed } : null), [active]);
  const [live, localEvent, deferred] = useRun(inst ?? '', sessionId, inst ? run : null, onEnd);
  // followed without a live stream (streams.ts): what waits for an answer comes from the approvals feed, which the
  // global bar hides for the session on screen
  const feed = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), enabled: deferred, refetchInterval: deferred ? 5_000 : false });
  const pendingFeed = deferred && active ? feed.data?.approvals.find((a) => a.sessionId === sessionId && a.runId === active.id) : undefined;
  const approval: Approval | null = live?.approval
    ?? (pendingFeed?.kind === 'approval' ? { requestId: pendingFeed.requestId, command: pendingFeed.command, description: pendingFeed.description, choices: pendingFeed.choices } : null);
  const clarify: Clarify | null = live?.clarify
    ?? (pendingFeed?.kind === 'clarify' ? { requestId: pendingFeed.requestId, question: pendingFeed.question ?? '', choices: pendingFeed.choices, multiSelect: pendingFeed.multiSelect } : null);

  const send = async (text: string, skills?: string[]): Promise<boolean> => (await launch(text, skills)) === null;
  /** Starts a run; the error, or null once started. */
  const launch = async (text: string, skills?: string[]): Promise<unknown> => {
    if (!inst) return new Error('Instance inconnue');
    setError(null);
    setOutcome(null);
    try {
      const res = await api.send(inst, sessionId, text, skills);
      setNotice(res.notice ?? null);
      // the server paused an active goal (the user writes)
      void qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) });
      const status: RunStatus | null = await api.runStatus(inst, sessionId, res.runId).catch(() => null);
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      setActive({ id: res.runId, createdAt: status?.createdAt ?? null, seed: [{ kind: 'user', key: `u-${res.runId}`, text, ts: Date.now() / 1000 }] });
      void invalidateSessionLists(qc);
      return null;
    } catch (err) {
      setError(err);
      return err;
    }
  };

  // the head of the queue leaves once the run is over (and not paused); a refused send puts it back and pauses
  useEffect(() => {
    if (active || drain === null || !inst) return;
    setDrain(null);
    if (queue.paused) return;
    const [head, rest] = takeHead(queue);
    if (!head) return;
    setQueue(rest);
    void launch(head.text, head.skills).then((err) => {
      if (err === null) return;
      const reason = err instanceof ApiError && err.status === 409 ? 'un autre onglet a lancé un travail' : 'l’envoi a échoué';
      setQueue((q) => pauseQueue(pushHead(q, head.text, head.skills), reason));
    });
  }, [active, drain]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const steerDisabled = approval || clarify ? 'Un accord ou une réponse est attendu'
    : !chat.has('chat', 'steer') ? 'Réorientation indisponible sur cette instance'
    : live?.status !== 'running' ? 'L’agent n’a pas encore commencé' : undefined;

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

  const rename = useMutation({
    mutationFn: (title: string) => api.updateSession(inst!, sessionId, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', inst, sessionId] }).then(() => invalidateSessionLists(qc)),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.updateSession(inst!, sessionId, { archived }),
    onSuccess: async (_res, archived) => {
      await invalidateSessionLists(qc);
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
      if (archived) goTo.leave(slug);
    },
  });
  const pin = useMutation({
    mutationFn: (pinned: boolean) => api.updateSession(inst!, sessionId, { pinned }),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void invalidateSessionLists(qc);
    },
  });
  /** Model / effort of the next messages (also remembered as the workspace's last choice). */
  const setOptions = useMutation({
    mutationFn: (patch: { model?: string | null; provider?: string | null; effort?: Effort | null; personality?: string | null; autoApprove?: boolean; profile?: string | null }) =>
      api.updateSession(inst!, sessionId, patch),
    onSuccess: (res, patch) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      // another agent: the effective profile (models, modes, personalities, skills) is read again
      if (patch.profile !== undefined) void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
      void qc.invalidateQueries({ queryKey: ['workspace', slug] });
    },
    onError: setError,
  });
  const { canCopy, canExportJson, canTitleAi } = useCopyOps(inst);
  const titleAi = useMutation({
    mutationFn: () => api.generateTitle(inst!, sessionId),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void invalidateSessionLists(qc);
    },
    onError: setError,
  });
  // « Sans confirmation »: Intendia approves every action of the agent in this session
  const setAutoApprove = async (on: boolean) => {
    if (on && !(await ask({
      title: 'Travailler sans confirmation ?', danger: true, confirmLabel: 'Activer',
      message: 'L’agent exécutera ses commandes et ses écritures sans vous demander votre accord, dans cette session seulement, tant que ce réglage reste actif. Les questions qu’il vous pose attendent toujours votre réponse.',
    }))) return;
    setOptions.mutate({ autoApprove: on });
  };
  // another agent: a session never sent changes agent; one with messages is copied there (the original stays)
  const changeProfile = async (profile: string) => {
    const s = sess.data?.session;
    if (!s || !inst) return;
    if (!s.lastRunId && !s.copiedFrom) { setOptions.mutate({ profile }); return; }
    if (!(await ask({
      title: `Continuer avec l’agent ${profile} ?`, confirmLabel: 'Copier la conversation',
      message: `La conversation est copiée chez l’agent ${profile}, dans ce workspace ; cette session reste telle quelle.${s.autoApprove ? ' « Sans confirmation » repart désactivé.' : ''}`,
    }))) return;
    try {
      const { session } = await api.toProfile(inst, sessionId, profile, newKey());
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.open(slug, session.id);
    } catch (err) {
      setError(err);
    }
  };
  const duplicate = useMutation({
    mutationFn: (key: string) => api.duplicateSession(inst!, sessionId, key),
    onSuccess: async ({ session }) => {
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.open(slug, session.id);
    },
    onError: setError,
  });
  // deleted at Hermes only once the undo window is over (banner « Annuler »)
  const remove = useMutation({
    mutationFn: () => api.deleteSession(inst!, sessionId),
    onSuccess: async ({ undoUntil }) => {
      showUndo({ inst: inst!, ids: [sessionId], undoUntil, label: 'Session supprimée' });
      forgetSideSession(inst!, sessionId);
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.leave(slug);
    },
    onError: setError,
  });

  // edit, retry, undo, clear (the session replaced by a truncated copy, « Annuler » for 10 s) and branch
  const rewrite = useMutation({
    mutationFn: async (a: { action: HistoryAction; before: number | null; text?: string }) => ({
      a, res: await api.rewriteSession(inst!, sessionId, { key: newKey(), before: a.before, mode: a.action === 'branch' ? 'branch' : 'replace' }),
    }),
    onSuccess: async ({ a, res }) => {
      const copy = res.session;
      // the banner first: starting the new run may take longer than the undo window
      let undone = false;
      if (a.action !== 'branch' && res.undoUntil) {
        const original = sessionId;
        showUndo({
          inst: inst!, ids: [], undoUntil: res.undoUntil, label: ACTION_LABEL[a.action],
          run: async () => {
            try {
              await api.revertRewrite(inst!, copy.id);
            } catch (err) {
              // a first answer lost: the original may be back already
              const back = err instanceof ApiError && err.status === 409 && await api.session(inst!, original).then(() => true, () => false);
              if (!back) throw err;
            }
            undone = true;
            await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
            goTo.open(slug, original, copy.id);
          },
        });
      }
      if (a.action === 'undo' && a.text) setDraft({ inst: inst!, sessionId: copy.id, text: a.text });
      if ((a.action === 'edit' || a.action === 'retry') && a.text) {
        try {
          const sent = await api.send(inst!, copy.id, a.text);
          setHandoff({ inst: inst!, sessionId: copy.id, runId: sent.runId, text: a.text, ts: Date.now() / 1000 });
        } catch (err) {
          // the copy is made: the text waits in its composer, with the reason
          setDraft({ inst: inst!, sessionId: copy.id, text: a.text, error: (err as Error).message });
        }
      }
      // « Annuler » clicked while the run was starting: the original is open, stay there
      if (undone) return;
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.open(slug, copy.id);
    },
    onError: setError,
  });
  // text given back by « Annuler le dernier échange », or a send refused after a replacement: once, into the composer
  const draftRead = useRef(false);
  useEffect(() => {
    if (!inst || draftRead.current) return;
    draftRead.current = true;
    const d = takeDraft(inst, sessionId);
    if (!d) return;
    composer.current?.setText(d.text);
    if (d.error) setError(new Error(d.error));
  }, [inst, sessionId]);

  const messages = history.data?.messages ?? [];
  const todos = useMemo(() => lastTodos(messages), [messages]);
  // todo_list, write_file or patch finished during the run: Hermes stored the call first, the history is read again
  // (task list, « Modifiés par l'agent »; last of a burst, 1 s later)
  const doneTodoCalls = live?.entries.filter((e) => e.kind === 'tool' && REREAD_TOOLS.has(e.tool) && e.state !== 'running').length ?? 0;
  const seenTodoCalls = useRef(0);
  useEffect(() => {
    if (doneTodoCalls <= seenTodoCalls.current) { seenTodoCalls.current = doneTodoCalls; return; }
    seenTodoCalls.current = doneTodoCalls;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] }), 1000);
    return () => clearTimeout(t);
  }, [doneTodoCalls, qc, inst, sessionId]);
  const delegations = useMemo(() => delegationState(messages), [messages]);
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
  // sessions of the background sub-agents (last activity, tools, end), re-read at the same pace as the history
  const children = useQuery({
    queryKey: ['session-subagents', inst, sessionId], queryFn: () => api.sessionSubagents(inst!, sessionId),
    enabled: Boolean(inst) && delegations.open.size > 0, retry: false, refetchOnWindowFocus: false,
    refetchInterval: () => pollDelay(subagents, Date.now() / 1000),
  });
  const entries: Entry[] = attachChildren(applyDeliveries(
    withTrees(active && live ? mergeHistory(messages, active.createdAt, live.entries) : historyEntries(messages), trees),
    delegations, Boolean(active),
  ), delegations.open.size > 0 ? children.data?.children ?? [] : []);
  const lastStatus = lastRun.data;
  // an empty session (« Nouvelle session », or one never used): the cursor goes to its message box, once
  const focusedEmpty = useRef<string | null>(null);
  const emptyReady = leading && history.isSuccess && entries.length === 0 && !active;
  useEffect(() => {
    if (!emptyReady || focusedEmpty.current === sessionId) return;
    focusedEmpty.current = sessionId;
    composer.current?.focus();
  }, [emptyReady, sessionId]);
  // its workspace can still change (moved: nothing sent, no file written), as on the home page
  const allWorkspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces, enabled: Boolean(inst) });
  // same instance and same agent (the server refuses another one, as the list's « Déplacer vers… »)
  const agentOf = sess.data?.profile ?? 'default';
  const siblings = (allWorkspaces.data?.workspaces ?? [])
    .filter((w) => w.instanceId === inst && (w.profile ?? 'default') === agentOf);
  const neverSent = Boolean(sess.data && !sess.data.session.lastRunId && !sess.data.session.copiedFrom);
  const moveTo = async (to: string | null) => {
    if (!to || to === slug || !inst) return;
    setError(null);
    try {
      const res = await api.bulkSessions(inst, [sessionId], 'move', to);
      const r = res.results[0];
      if (!r?.ok) throw new Error(r?.error ?? 'Déplacement refusé');
      await invalidateSessionLists(qc);
      goTo.open(to, sessionId);
    } catch (err) {
      setError(err);
    }
  };
  const endNote = !active && (outcome ?? (lastStatus && OUTCOME[lastStatus.status] ? { status: lastStatus.status, error: lastStatus.error ?? lastStatus.output, input: null } : null));
  // Hermes does not keep the message of a run that failed before starting: keep it on screen.
  const lostInput = endNote && endNote.input && !messages.some((m) => m.role === 'user' && m.content === endNote.input) ? endNote.input : null;
  if (lostInput) entries.push({ kind: 'user', key: 'lost-input', text: lostInput, ts: null });
  // run lines go under the history entries; the run of a message Hermes did not keep goes under it
  const runs = history.data?.runs ?? [];
  const footers = useMemo(() => {
    const m = placeRunStats(historyEntries(messages), runs);
    if (lostInput && runs.length) {
      const last: RunStat = runs[runs.length - 1]!;
      for (const [k, list] of m) {
        const rest = list.filter((r) => r.runId !== last.runId);
        if (rest.length) m.set(k, rest); else m.delete(k);
      }
      m.set('lost-input', [last]);
    }
    return m;
  }, [messages, runs, lostInput]);
  const running = Boolean(active);
  /** The session exists at Hermes (sent once, or a copy): it has something to copy and export. */
  const sentOnce = Boolean(sess.data?.session.lastRunId || sess.data?.session.copiedFrom);
  // history actions: not during a run, nor with messages waiting (they would stay on the replaced session)
  const historyFree = !running && queued === 0 && sentOnce && !rewrite.isPending;
  const canRewrite = historyFree && canCopy;
  const last = lastUser(entries);
  const lastTurn = (() => {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'user' && !(entries[i] as { steer?: boolean }).steer) return entries[i + 1]?.key ?? null;
    return null;
  })();
  const runRewrite = (action: HistoryAction, key?: string, text?: string) => {
    const before = cutFor(entries, action, key);
    if (before !== undefined) rewrite.mutate({ action, before, text });
  };
  const threadActions: ThreadActions | undefined = canRewrite ? {
    canEdit: (key) => cutFor(entries, 'edit', key) !== undefined,
    edit: (key, text) => runRewrite('edit', key, text),
    retryTurn: last && lastTurn ? lastTurn : null,
    retry: () => runRewrite('retry', undefined, last?.text),
    canBranch: (key) => cutFor(entries, 'branch', key) !== undefined,
    branch: (key) => runRewrite('branch', key),
    busy: rewrite.isPending,
  } : undefined;
  // context gauge: read on opening and after each run
  const usage = useQuery({
    queryKey: ['usage', inst, sessionId, runCount], queryFn: () => api.sessionUsage(inst!, sessionId),
    enabled: Boolean(inst), staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const estimate = estimateTokens(entries);
  // « /usage »: a line under the composer, closed by × or the next message
  const [usageOpen, setUsageOpen] = useState(false);

  // persistent goal (option 7): relaunched by the server; the bar above the composer, the dialog of /goal
  const goalQ = useGoal(inst, sessionId);
  const [goalDialog, setGoalDialog] = useState<{ editing: boolean; initial: Partial<GoalSettings> } | null>(null);
  const saveGoal = async (g: GoalSettings) => {
    if (!inst) return;
    if (goalDialog?.editing) await api.editGoal(inst, sessionId, g);
    else {
      const res = await api.createGoal(inst, sessionId, g);
      // the first turn leaves with the goal's text: follow it like a sent message
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: { ...old.session, lastRunId: res.runId } });
      setActive({ id: res.runId, createdAt: null, seed: [{ kind: 'user', key: `u-${res.runId}`, text: g.text, ts: Date.now() / 1000 }] });
      void invalidateSessionLists(qc);
    }
    await qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) });
    await qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
  };

  // slash commands of the composer: the same actions as the menu and the thread, with the reason when not possible
  const rewriteWhy = !sentOnce ? 'La conversation est vide' : running ? 'L’agent travaille' : queued > 0 ? 'Des messages attendent dans la file'
    : !canCopy ? 'Indisponible sur cette instance' : rewrite.isPending ? 'Une action est en cours' : undefined;
  const branchKey = lastTurn ?? undefined;
  const commands: Command[] = COMMANDS.map((c) => {
    const disabled = ({
      new: undefined,
      clear: rewriteWhy,
      undo: rewriteWhy ?? (last ? undefined : 'Le dernier message n’est pas enregistré'),
      retry: rewriteWhy ?? (last && lastTurn ? undefined : 'Aucune réponse à relancer'),
      branch: rewriteWhy ?? (branchKey && cutFor(entries, 'branch', branchKey) !== undefined ? undefined : 'Aucune réponse pour la branche'),
      title: undefined,
      usage: undefined,
      stop: running ? undefined : 'Aucun travail en cours',
      prompt: undefined,
      use: skillNames.length ? undefined : 'Aucun skill activé pour cet agent',
      goal: undefined,
    } satisfies Record<CommandName, string | undefined>)[c.name];
    return disabled ? { ...c, disabled } : c;
  });
  const onCommand = async (name: CommandName, arg: string): Promise<boolean> => {
    setError(null);
    try {
      switch (name) {
        case 'new': {
          const { session } = await api.createSession(slug);
          await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
          goTo.open(slug, session.id);
          return true;
        }
        case 'clear': runRewrite('clear'); return true;
        case 'undo': runRewrite('undo', undefined, last?.text); return true;
        case 'retry': runRewrite('retry', undefined, last?.text); return true;
        case 'branch': runRewrite('branch', branchKey); return true;
        case 'title':
          if (arg) await rename.mutateAsync(arg);
          else if (!canTitleAi) { setError(new Error('Titre par l’IA indisponible sur cette instance : /title suivi du nom renomme la session')); return false; }
          else if (!sentOnce) { setError(new Error('La conversation est vide : rien pour faire un titre')); return false; }
          else await titleAi.mutateAsync();
          return true;
        case 'usage': setUsageOpen(true); void usage.refetch(); return true;
        case 'stop': await stop(); return true;
        case 'prompt': composer.current?.openPrompts(arg); return true;
        case 'use': return true; // handled by the composer (a pill)
        case 'goal': {
          const g = goalQ.data;
          // « /goal » alone on a goal not finished: edit it; else a new goal (the text after /goal prefilled)
          if (!arg && g && g.status !== 'done') setGoalDialog({ editing: true, initial: g });
          else setGoalDialog({ editing: false, initial: { text: arg } });
          return true;
        }
      }
    } catch (err) {
      setError(err);
      return false;
    }
  };

  // Follow the bottom of the thread while it grows (new turns, streamed text, images that load), unless the reader
  // scrolled up. `measure` (chat/follow.ts) judges from the scroll position, measured on each scroll event and again
  // just before each automatic scroll: a scroll event comes one frame late, after a burst of text may have landed, and
  // must not be read as the reader leaving the bottom. The page opens at the bottom.
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef<FollowState>({ pinned: true, lastTop: 0, lastHeight: 0 });
  // the element that scrolls the thread: the page's <main>, or the column of the Chat page
  const box = () => bottom.current?.closest<HTMLElement>('[data-scroll-root]') ?? null;
  // to the very end of the page: the composer sticks below the thread, the last turn must sit above it
  const toEnd = (main: HTMLElement) => {
    main.scrollTop = main.scrollHeight;
    follow.current = { pinned: true, lastTop: main.scrollTop, lastHeight: main.scrollHeight };
  };
  const followIfPinned = () => {
    const main = box();
    if (!main) return;
    follow.current = measure(follow.current, main);
    if (follow.current.pinned) toEnd(main);
  };
  const tail = entries.length + (entries.at(-1) && 'text' in entries.at(-1)! ? (entries.at(-1) as { text: string }).text.length : 0);
  useEffect(() => {
    const main = box();
    const thread = bottom.current?.parentElement;
    if (!main || !thread) return;
    follow.current = startFollow(main);
    const onScroll = () => { follow.current = measure(follow.current, main); };
    const grow = new ResizeObserver(followIfPinned);
    grow.observe(thread);
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => { grow.disconnect(); main.removeEventListener('scroll', onScroll); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(followIfPinned, [tail, approval, clarify]); // eslint-disable-line react-hooks/exhaustive-deps

  // « Afficher les heures » (time of each step) and « Plan » / ↑ ↓ (jump between the user's questions)
  const [times, setTimes] = useStoredFlag('intendia-thread-times');
  const timeMap = useMemo(() => (times ? stamps(entries) : undefined), [times, entries]);
  const items = useMemo(() => outline(entries), [entries]);
  const header = useRef<HTMLElement>(null);
  const turnEl = (key: string) => box()?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;
  const jumpTo = (key: string) => {
    const main = box();
    const el = turnEl(key);
    if (!main || !el) return;
    const head = header.current?.getBoundingClientRect().height ?? 0;
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - head - 8;
    el.classList.add('ring-2', 'ring-accent');
    setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 1200);
  };
  /** Index of the current question: the last one whose top has reached the top of the view (under the header). */
  const currentTurn = (): number => {
    const main = box();
    if (!main) return -1;
    const line = main.getBoundingClientRect().top + (header.current?.getBoundingClientRect().height ?? 0) + 24;
    let at = -1;
    items.forEach((it, i) => { const el = turnEl(it.key); if (el && el.getBoundingClientRect().top <= line) at = i; });
    return at;
  };
  const jump = (dir: -1 | 1) => {
    if (!items.length) return;
    const at = currentTurn();
    if (dir === 1) { const next = items[at + 1]; if (next) jumpTo(next.key); return; }
    if (at < 0) return;
    // ↑ goes back to the top of the current question when the reader went down its turn, else to the previous one
    const main = box()!;
    const el = turnEl(items[at]!.key);
    const top = main.getBoundingClientRect().top + (header.current?.getBoundingClientRect().height ?? 0);
    const inside = el ? el.getBoundingClientRect().top < top - 4 : false;
    const target = inside ? items[at] : items[at - 1];
    if (target) jumpTo(target.key);
  };
  const jumpRef = useRef(jump);
  const inactive = useRef(false);
  inactive.current = Boolean(col && !col.active);
  jumpRef.current = jump;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // several columns on the Chat page: the active one only
      if (inactive.current) return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) {
        // in the message field only, and only when the caret is at the edge it moves towards (or the field is empty)
        if (t.getAttribute('aria-label') !== 'Message') return;
        const { selectionStart: a, selectionEnd: b, value } = t;
        const edge = value === '' || (a === b && (e.key === 'ArrowUp' ? a === 0 : a === value.length));
        if (!edge) return;
      } else if (t?.isContentEditable) return;
      e.preventDefault();
      jumpRef.current(e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = sess.data?.session.title || 'Nouvelle session';
  // the reading width, unless the column is one of several on screen
  const narrow = !col || col.wide;
  // the Chat page's tabs show what the column is doing
  const waiting = Boolean(approval || clarify);
  const report = col?.report;
  useEffect(() => { report?.({ running, waiting, title }); }, [report, running, waiting, title]);

  // files written by the agent (stored write_file / patch calls), most recent first; from the whole stored history
  // (during a run, the merged entries hide its stored messages behind the live ones)
  const written = useMemo(() => writtenPaths(historyEntries(messages)), [messages]);
  // Paths cited by the assistant and the tools; the server says which exist (one lookup per new set).
  const candidates = useMemo(() => {
    if (!mounts) return [];
    const text = entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind === 'tool' ? `${e.preview ?? ''}\n${e.result ?? ''}` : e.kind === 'subagents' ? e.nodes.map((n) => n.summary ?? '').join('\n') : '')).join('\n');
    const m = { root: mounts.files?.workspaceRoot ?? null };
    // artefacts first: never cut by the 200 checked
    const pages = entries.flatMap((e) => (e.kind === 'assistant' ? artifactPaths(e.text) : []));
    const cited = findPathCandidates(text, m).sort();
    // files joined to the user's messages come after, so they never push the agent's out of the 200 checked
    const joined = entries.flatMap((e) => (e.kind === 'user' ? splitAttachments(e.text, m).files : []));
    return [...new Set([...pages, ...written.map((w) => w.path), ...cited, ...joined])];
  }, [entries, mounts, written]);
  const exists = useQuery({
    queryKey: ['exists', slug, candidates.join('\n'), runCount],
    queryFn: () => api.filesExist(slug, candidates.slice(0, 200)),
    enabled: candidates.length > 0,
    staleTime: 60_000,
    // the chips and artefacts already found stay while a new set of paths is checked
    placeholderData: keepPreviousData,
  });
  const filePaths = useMemo<FilePathsValue>(() => {
    const found = new Map<string, string>();
    for (const [written, hit] of Object.entries(exists.data?.results ?? {})) if (hit?.kind === 'file') found.set(written, hit.path);
    return {
      found, open: (path) => { setPreviewPath(path); setPanel(true); }, slug,
      pending: exists.isFetching && !exists.data,
      mounts: mounts ? { root: mounts.files?.workspaceRoot ?? null } : null,
    };
  }, [exists.data, exists.isFetching, slug, mounts]);
  const cited = useMemo(() => [...new Set(filePaths.found.values())], [filePaths]);
  const modified = useMemo(() => written.map((w) => ({ ...w, rel: w.op === 'delete' ? null : filePaths.found.get(w.path) ?? null })), [written, filePaths]);
  const agentRoot = mounts?.files?.workspaceRoot ? `${mounts.files.workspaceRoot.replace(/\/+$/, '')}/${slug}` : undefined;
  const insert = useCallback((path: string) => composer.current?.insert(path), []);

  const upload = useCallback<Upload>(async (file) => {
    const [done] = await uploadFiles(slug, 'inbox', [file]);
    void qc.invalidateQueries({ queryKey: ['tree', slug] });
    return { agentPath: done!.agentPath, url: rawUrl(slug, done!.path), path: done!.path };
  }, [slug, qc]);
  const extract = useCallback<ExtractArchive>(async (path) => {
    const r = await api.extractArchive(slug, path);
    void qc.invalidateQueries({ queryKey: ['tree', slug] });
    return r;
  }, [slug, qc]);
  const addFiles = (f: File[]) => composer.current?.addFiles(f);

  const side = previewPath ? (
    <Preview scope={workspaceScope(slug)} path={previewPath} onClose={() => setPreviewPath(null)} onInsert={insert} />
  ) : (
    <SessionFiles inst={inst ?? ''} slug={slug} sessionId={sessionId} onDrop={addFiles} cited={cited} runKey={runCount} onOpen={setPreviewPath} onClose={() => setPanel(false)}
      agentRoot={agentRoot} onInsert={insert} modified={modified} />
  );

  return (
    <FilePaths.Provider value={filePaths}>
    <div className={col ? 'flex h-full' : 'flex min-h-full'}>
    <Scroller inColumn={Boolean(col)}>
    <DropZone onFiles={addFiles} label="Déposer dans inbox/ et joindre au message" className={cx('flex min-w-0 flex-1 flex-col', col ? 'min-h-full' : EMBEDDED ? 'min-h-dvh' : 'min-h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom))] md:min-h-[var(--content-h)]')}>
      <header ref={header} className="sticky top-0 z-10 border-b border-line/70 bg-sheet/95 backdrop-blur-sm">
        <div className="flex min-h-16 items-center gap-2 px-4 py-3 md:px-6">
          {!EMBEDDED && (
            <Link to="/" aria-label="Revenir à la liste" className={cx(ICON_BTN, 'border-transparent md:hidden')}>
              <ArrowLeft className="size-4" strokeWidth={1.5} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h2 data-session-title className="truncate text-lg font-semibold leading-snug">{title}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">
              {[mounts?.label, null, sess.data?.profile ?? 'default', sess.data?.session.model ? shortModel(sess.data.session.model) : null, sess.data ? when(sess.data.session.createdAt) : null]
                .map((part, i) => (i === 1
                  ? <span key="ws">{i > 0 && mounts?.label ? ' · ' : ''}<Link to="/w/$slug" params={{ slug }} className="transition-colors hover:text-ink">{ws.data?.workspace.name ?? slug}</Link></span>
                  : part ? <span key={i}>{i > 0 ? ' · ' : ''}{part}</span> : null))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={ICON_BTN} aria-label="Copier le lien de la session" title="Copier le lien de la session"
              onClick={() => void copyText(window.location.origin + window.location.pathname, 'Lien de la session').then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); })}>
              {linkCopied ? <Check className="size-4" strokeWidth={2} /> : <Link2 className="size-4" strokeWidth={1.5} />}
            </button>
            <button type="button" className={cx(ICON_BTN, sideOpen && 'bg-raised')} aria-label="Fichiers de la session" title="Fichiers de la session"
              aria-expanded={panel} onClick={() => { setPanel(!panel); setPreviewPath(null); }}>
              <PanelRight className="size-4" strokeWidth={1.5} />
            </button>
            {items.length >= OUTLINE_MIN && <TurnPlan items={items} onJump={jumpTo} triggerClass={ICON_BTN} />}
            <Menu
              title="Actions de la session"
              trigger={<Ellipsis className="size-4" strokeWidth={1.5} />}
              triggerClass={cx(ICON_BTN, 'aria-expanded:bg-raised')}
              items={[
                { label: 'Renommer', icon: <Pencil className="size-4" strokeWidth={1.5} />,
                  onSelect: async () => { const t = await askText({ title: 'Renommer la session', label: 'Nouveau titre', value: sess.data?.session.title ?? '', confirmLabel: 'Renommer' }); if (t) rename.mutate(t); } },
                sess.data?.session.pinned
                  ? { label: 'Désépingler', icon: <PinOff className="size-4" strokeWidth={1.5} />, onSelect: () => pin.mutate(false) }
                  : { label: 'Épingler', icon: <Pin className="size-4" strokeWidth={1.5} />, onSelect: () => pin.mutate(true) },
                sess.data?.session.archived
                  ? { label: 'Désarchiver', icon: <ArchiveRestore className="size-4" strokeWidth={1.5} />, onSelect: () => archive.mutate(false) }
                  : { label: 'Archiver', icon: <Archive className="size-4" strokeWidth={1.5} />, disabled: running, onSelect: () => archive.mutate(true) },
                ...(sentOnce && !canCopy ? [] : [{ label: 'Dupliquer', icon: <Copy className="size-4" strokeWidth={1.5} />, disabled: running || duplicate.isPending, onSelect: () => duplicate.mutate(newKey()) }]),
                times
                  ? { label: 'Masquer les heures', icon: <Clock className="size-4" strokeWidth={1.5} />, onSelect: () => setTimes(false) }
                  : { label: 'Afficher les heures', icon: <Clock className="size-4" strokeWidth={1.5} />, onSelect: () => setTimes(true) },
                ...(sentOnce ? [
                  { label: 'Exporter en Markdown', icon: <Download className="size-4" strokeWidth={1.5} />, onSelect: () => download(api.exportUrl(inst!, sessionId, 'md')) },
                  { label: 'Exporter en HTML', icon: <Download className="size-4" strokeWidth={1.5} />, onSelect: () => download(api.exportUrl(inst!, sessionId, 'html')) },
                  ...(canExportJson ? [{ label: 'Exporter en JSON', icon: <Download className="size-4" strokeWidth={1.5} />, onSelect: () => download(api.exportUrl(inst!, sessionId, 'json')) }] : []),
                ] : []),
                ...(sentOnce && canCopy ? [{ label: 'Annuler le dernier échange', icon: <Undo2 className="size-4" strokeWidth={1.5} />, disabled: !canRewrite || !last, onSelect: () => runRewrite('undo', undefined, last?.text) }] : []),
                ...(sentOnce && canCopy ? [{ label: 'Vider la conversation', icon: <Eraser className="size-4" strokeWidth={1.5} />, disabled: !canRewrite, onSelect: () => runRewrite('clear') }] : []),
                ...(sentOnce && canTitleAi ? [{ label: 'Titre par l’IA', icon: <Sparkles className="size-4" strokeWidth={1.5} />, disabled: titleAi.isPending, onSelect: () => titleAi.mutate() }] : []),
                sess.data?.session.autoApprove
                  ? { label: 'Redemander les accords', icon: <ShieldCheck className="size-4" strokeWidth={1.5} />, onSelect: () => void setAutoApprove(false) }
                  : { label: 'Sans confirmation…', icon: <ShieldOff className="size-4" strokeWidth={1.5} />, onSelect: () => void setAutoApprove(true) },
                { label: 'Supprimer', icon: <Trash2 className="size-4" strokeWidth={1.5} />, disabled: running, danger: true, onSelect: () => remove.mutate() },
              ]}
            />
            {col && (
              <button type="button" className={ICON_BTN} aria-label="Fermer ce chat" title="Fermer ce chat (le travail continue)" onClick={col.hide}>
                <X className="size-4" strokeWidth={1.5} />
              </button>
            )}
            {!sideOpen && !EMBEDDED && !col && <FullScreen />}
          </div>
        </div>
      </header>

      <div className={cx('mx-auto w-full flex-1 px-4 py-7 md:px-6', narrow && 'max-w-[748px]')}>
        <div className="mb-6 empty:hidden"><ChatNotice instanceId={inst} /></div>
        {history.isSuccess && entries.length === 0 && !running && !endNote && (
          <div className="py-16 text-center">
            <p className="text-base font-semibold">Nouvelle session dans {ws.data?.workspace.name}</p>
            {neverSent && siblings.length > 1 && (
              <div className="mt-2 flex justify-center" data-move-empty>
                <Picker
                  title="Workspace de cette session" placement="below" value={slug}
                  items={siblings.map((w) => ({ value: w.slug, label: w.name }))}
                  onPick={(v) => void moveTo(v)}
                  label={<>Changer de workspace</>}
                />
              </div>
            )}
            <p className="mt-1.5 text-sm text-ink-faint">L’agent travaille dans le dossier du workspace et range ses fichiers dans celui de la session</p>
          </div>
        )}
        {messages.length >= 500 && <p className="mb-4 text-center text-xs text-ink-faint">Messages plus anciens non affichés</p>}
        {live?.truncated && (
          <p className="mb-4 text-xs text-ink-faint">Le début de ce run n’est plus disponible en direct : il apparaîtra à la fin</p>
        )}
        <Thread entries={entries} footers={footers} agent={agent} actions={threadActions} times={timeMap} liveDeliveries subagents={subagents} />
        {running && !approval && !clarify && <ThinkingIndicator entries={entries} agent={agent} />}
        {running && deferred && (
          <p data-deferred className={cx('mt-2 text-xs text-ink-faint', AGENT_INDENT)}>Suivi en différé : trois suivis en direct sont déjà ouverts. La réponse s’affichera à la fin.</p>
        )}
        {approval && (
          <div className="mt-5"><ApprovalCard approval={approval} onChoose={approve} busy={busy} /></div>
        )}
        {clarify && (
          <div className="mt-5"><ClarifyCard key={clarify.requestId ?? ''} clarify={clarify} onAnswer={(t) => void answer(t)} busy={busy} /></div>
        )}
        {endNote && (
          <div className={cx('mt-5', AGENT_INDENT)}>
            <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              <span className="font-medium">{OUTCOME[endNote.status]}</span>
              {endNote.error ? ` : ${endNote.error}` : ''}
            </div>
          </div>
        )}
        <div ref={bottom} className="h-4" />
      </div>

      <div className="sticky bottom-0 bg-linear-to-t from-sheet from-70% to-transparent pt-4">
        <div className={cx('relative mx-auto px-4 pb-4 md:px-6 md:pb-5', narrow && 'max-w-[796px]')}>
          {items.length >= OUTLINE_MIN && (
            <div className="absolute bottom-full right-4 mb-1 md:right-6"><TurnJump onPrev={() => jump(-1)} onNext={() => jump(1)} /></div>
          )}
          {todos && todos.length > 0 && <Todos todos={todos} />}
          {subagents && subagents.openTasks > 0 && !active && <SubagentsBar summary={subagents} />}
          {inst && goalQ.data && (
            <GoalBar
              inst={inst} sessionId={sessionId} sessionLastRunId={lastRunId} goal={goalQ.data}
              onEdit={() => setGoalDialog({ editing: true, initial: goalQ.data! })}
            />
          )}
          {goalDialog && (
            <GoalDialog
              initial={goalDialog.initial} editing={goalDialog.editing} autoApprove={Boolean(sess.data?.session.autoApprove)}
              onSubmit={saveGoal} onClose={() => setGoalDialog(null)}
            />
          )}
          <div className="mb-2 empty:hidden"><ErrorText error={error} /></div>
          <Composer
            ref={composer}
            upload={upload}
            extract={extract}
            prompts
            draftKey={inst ? sessionDraftKey(inst, sessionId) : undefined}
            onSend={(t, sk) => { setUsageOpen(false); return send(t, sk); }}
            skillNames={skillNames}
            notice={notice}
            autoApprove={sess.data?.session.autoApprove ? { onOff: () => void setAutoApprove(false) } : null}
            onStop={stop}
            commands={commands}
            onCommand={onCommand}
            running={running}
            disabled={!chat.available || !inst}
            onQueue={(text, sk) => {
              setQueue((q) => enqueue(q, text, sk));
              // a message waiting is the user writing: an active goal pauses before the loop relaunches
              if (inst && goalQ.data?.status === 'active') {
                void api.pauseGoal(inst, sessionId, 'user').then(() => qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) }), () => {});
              }
            }}
            onSteer={steer}
            steerDisabled={steerDisabled}
            queue={{
              items: queue.items, paused: queue.paused,
              onRemove: (id) => setQueue((q) => dropItem(q, id)),
              onResume: () => { setQueue(resumeQueue); if (!active) setDrain(`resume-${Date.now()}`); },
            }}
            options={inst && sess.data && (
              <RunOptions
                inst={inst} profile={sess.data.profile ?? 'default'}
                model={sess.data.session.model} provider={sess.data.session.modelProvider} effort={sess.data.session.effort}
                personality={sess.data.session.personality ?? null} onProfile={(p) => void changeProfile(p)}
                hasRuns={Boolean(lastRunId)} disabled={running || setOptions.isPending || !chat.available}
                onChange={(patch) => setOptions.mutate(patch)}
              />
            )}
            placeholder={running ? (live?.status === 'waiting_for_approval' ? 'En attente de votre approbation' : live?.status === 'waiting_for_clarify' ? 'Hermes vous pose une question' : 'L’agent travaille… Entrée met votre message en file') : entries.length ? `Répondre à ${agent}…` : `Écrire à ${agent}…`}
            hint={entries.length ? <ContextGauge usage={usage.data} estimate={estimate} />
              : running ? 'Entrée : mettre en file · Réorienter : donner le texte tout de suite' : 'Entrée : envoyer · Maj+Entrée : à la ligne · / : commandes'}
          />
          {usageOpen && (
            <div data-usage-line className="mt-2 flex items-start gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-[12px] text-ink-soft">
              <p className="min-w-0 flex-1">{usageText(usage.data, estimate, usage.isFetching)}</p>
              <button type="button" onClick={() => setUsageOpen(false)} aria-label="Fermer" className="text-ink-faint hover:text-ink">
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </div>
    </DropZone>
    </Scroller>
    {panel && (
      <aside className={cx(
        // a column beside others is too narrow to share: the panel covers it (its close button stays in the panel)
        col && !col.wide
          ? 'absolute inset-y-0 right-0 z-20 w-full max-w-full border-l border-line/70 bg-sheet shadow-xl'
          : 'fixed inset-0 z-30 bg-sheet lg:z-auto lg:shrink-0 lg:border-l lg:border-line/70',
        col ? (col.wide && 'lg:static lg:h-full') : 'lg:sticky lg:top-0 lg:h-[var(--content-h)]',
        !(col && !col.wide) && (previewPath ? 'lg:w-[min(46vw,640px)]' : 'lg:w-[340px]'),
      )}>
        {side}
      </aside>
    )}
    </div>
    </FilePaths.Provider>
  );
}

/** Text of « /usage »: the context (counted by Hermes or estimated) and the plan quota when the gateway gives it. */
function usageText(usage: Awaited<ReturnType<typeof api.sessionUsage>> | undefined, estimate: number, fetching: boolean): string {
  if (!usage && fetching) return 'Lecture de l’utilisation…';
  const exact = usage?.exact ?? null;
  const max = exact?.max ?? usage?.max ?? null;
  const used = exact?.used ?? estimate;
  const context = `Contexte : ${exact ? '' : '≈ '}${formatTokens(used)}${max ? ` sur ${formatTokens(max)} jetons (${Math.round((used / max) * 100)} %)` : ' jetons (taille du modèle inconnue)'}`
    + (exact ? ', compté par Hermes' : ', estimé à partir du fil');
  const q = usage?.quota;
  const quota = q ? ` · ${q.label ?? 'Forfait'} : ${Math.round(q.usedPercent)} % utilisés${q.resetsAt ? `, remise à zéro ${new Date(q.resetsAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}` : '';
  return context + quota;
}
