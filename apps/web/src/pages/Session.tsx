import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Check, Ellipsis, Link2, PanelRight, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { SESSION_LIST_KEYS, showUndo } from '../sessions/UndoBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, rawUrl, type ApprovalChoice, type Effort, type RunStat, type RunStatus } from '../api';
import { historyEntries, isTerminal, mergeHistory, withTrees, type Entry, type RunState } from '../chat/events';
import { Composer, type ComposerHandle, type Upload } from '../chat/Composer';
import { ContextGauge } from '../chat/ContextGauge';
import { estimateTokens } from '../chat/estimate';
import { agentName, costSettling, COST_POLL_MS, placeRunStats } from '../chat/format';
import { measure, startFollow, type FollowState } from '../chat/follow';
import { EMPTY_QUEUE, dropItem, enqueue, firstTime, loadQueue, pauseQueue, pushHead, resumeQueue, saveQueue, takeHead, type Queue } from '../chat/queue';
import { RunOptions } from '../chat/RunOptions';
import { AGENT_INDENT, ApprovalCard, ThinkingIndicator, Thread } from '../chat/Thread';
import { ClarifyCard } from '../chat/ClarifyCard';
import { useRun } from '../chat/useRun';
import { ChatNotice, useChatAvailability } from '../components/ChatNotice';
import { SessionFiles } from '../components/SessionFiles';
import { DropZone } from '../files/DropZone';
import { FilePaths, type FilePathsValue } from '../files/FilePaths';
import { findPathCandidates } from '../files/paths';
import { splitAttachments } from '../chat/attachments';
import { Preview } from '../files/Preview';
import { uploadFiles } from '../files/upload';
import { takeHandoff } from '../home/handoff';
import { Menu } from '../components/Menu';
import { Button, copyText, cx, ErrorText } from '../components/ui';
import { ask, askText } from '../components/Dialog';
import { workspaceScope } from '../files/scope';

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

function SessionView({ slug, sessionId }: { slug: string; sessionId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const inst = ws.data?.workspace.instanceId;
  const sess = useQuery({ queryKey: ['session', inst, sessionId], queryFn: () => api.session(inst!, sessionId), enabled: Boolean(inst) });
  const [active, setActive] = useState<ActiveRun | null>(null);
  const history = useQuery({
    queryKey: ['messages', inst, sessionId], queryFn: () => api.messages(inst!, sessionId),
    enabled: Boolean(inst), refetchOnWindowFocus: false,
    // Hermes writes costs late: the last reply's cost is re-read until the server freezes it
    refetchInterval: (q) => (!active && costSettling(q.state.data?.runs) ? COST_POLL_MS : false),
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
  const [panel, setPanel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
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
  useEffect(() => { localStorage.setItem('intendia-last-workspace', slug); }, [slug]);

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
    if (tree) setTrees((t) => [...t, tree]);
    const input = state.entries.find((e): e is Extract<Entry, { kind: 'user' }> => e.kind === 'user' && !e.steer)?.text ?? null;
    setOutcome(OUTCOME[state.status] ? { status: state.status, error: state.error, input } : null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] }),
      qc.invalidateQueries({ queryKey: ['run', inst, sessionId] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
    ]);
    setActive(null);
    setRunCount((n) => n + 1);
    void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
  }, [qc, inst, sessionId]);

  const run = useMemo(() => (active ? { id: active.id, seed: active.seed } : null), [active]);
  const [live, localEvent] = useRun(inst ?? '', sessionId, inst ? run : null, onEnd);

  const send = async (text: string): Promise<boolean> => (await launch(text)) === null;
  /** Starts a run; the error, or null once started. */
  const launch = async (text: string): Promise<unknown> => {
    if (!inst) return new Error('Instance inconnue');
    setError(null);
    setOutcome(null);
    try {
      const res = await api.send(inst, sessionId, text);
      const status: RunStatus | null = await api.runStatus(inst, sessionId, res.runId).catch(() => null);
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      setActive({ id: res.runId, createdAt: status?.createdAt ?? null, seed: [{ kind: 'user', key: `u-${res.runId}`, text, ts: Date.now() / 1000 }] });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
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
    void launch(head.text).then((err) => {
      if (err === null) return;
      const reason = err instanceof ApiError && err.status === 409 ? 'un autre onglet a lancé un travail' : 'l’envoi a échoué';
      setQueue((q) => pauseQueue(pushHead(q, head.text), reason));
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
  const steerDisabled = live?.approval || live?.clarify ? 'Un accord ou une réponse est attendu'
    : !chat.has('chat', 'steer') ? 'Réorientation indisponible sur cette instance'
    : live?.status !== 'running' ? 'L’agent n’a pas encore commencé' : undefined;

  const approve = async (choice: ApprovalChoice) => {
    if (!inst || !active || !live?.approval) return;
    setBusy(true);
    try {
      await api.approve(inst, sessionId, active.id, choice, live.approval.requestId ?? undefined);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (text: string) => {
    if (!inst || !active || !live?.clarify) return;
    setBusy(true);
    try {
      await api.clarify(inst, sessionId, active.id, text, live.clarify.requestId ?? undefined);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', inst, sessionId] }).then(() => qc.invalidateQueries({ queryKey: ['sessions'] })),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.updateSession(inst!, sessionId, { archived }),
    onSuccess: async (_res, archived) => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
      if (archived) await navigate({ to: '/w/$slug', params: { slug } });
    },
  });
  const pin = useMutation({
    mutationFn: (pinned: boolean) => api.updateSession(inst!, sessionId, { pinned }),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
  /** Model / effort of the next messages (also remembered as the workspace's last choice). */
  const setOptions = useMutation({
    mutationFn: (patch: { model?: string | null; provider?: string | null; effort?: Effort | null }) => api.updateSession(inst!, sessionId, patch),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void qc.invalidateQueries({ queryKey: ['workspace', slug] });
    },
    onError: setError,
  });
  // deleted at Hermes only once the undo window is over (banner « Annuler »)
  const remove = useMutation({
    mutationFn: () => api.deleteSession(inst!, sessionId),
    onSuccess: async ({ undoUntil }) => {
      showUndo({ inst: inst!, ids: [sessionId], undoUntil, label: 'Session supprimée' });
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      await navigate({ to: '/w/$slug', params: { slug } });
    },
    onError: setError,
  });

  const messages = history.data?.messages ?? [];
  const entries: Entry[] = withTrees(active && live ? mergeHistory(messages, active.createdAt, live.entries) : historyEntries(messages), trees);
  const lastStatus = lastRun.data;
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
  // context gauge: read on opening and after each run
  const usage = useQuery({
    queryKey: ['usage', inst, sessionId, runCount], queryFn: () => api.sessionUsage(inst!, sessionId),
    enabled: Boolean(inst), staleTime: 60_000, refetchOnWindowFocus: false,
  });
  const estimate = estimateTokens(entries);

  // Follow the bottom of the thread while it grows (new turns, streamed text, images that load), unless the reader
  // scrolled up. `measure` (chat/follow.ts) judges from the scroll position, measured on each scroll event and again
  // just before each automatic scroll: a scroll event comes one frame late, after a burst of text may have landed, and
  // must not be read as the reader leaving the bottom. The page opens at the bottom.
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef<FollowState>({ pinned: true, lastTop: 0, lastHeight: 0 });
  const box = () => bottom.current?.closest('main') ?? null;
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
  useEffect(followIfPinned, [tail, live?.approval, live?.clarify]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = sess.data?.session.title || 'Nouvelle session';

  // Paths cited by the assistant and the tools; the server says which exist (one lookup per new set).
  const candidates = useMemo(() => {
    if (!mounts) return [];
    const text = entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind === 'tool' ? `${e.preview ?? ''}\n${e.result ?? ''}` : e.kind === 'subagents' ? e.nodes.map((n) => n.summary ?? '').join('\n') : '')).join('\n');
    const m = { root: mounts.files?.workspaceRoot ?? null };
    const cited = findPathCandidates(text, m).sort();
    // files joined to the user's messages come after, so they never push the agent's out of the 200 checked
    const joined = entries.flatMap((e) => (e.kind === 'user' ? splitAttachments(e.text, m).files : [])).filter((f) => !cited.includes(f));
    return [...cited, ...new Set(joined)];
  }, [entries, mounts]);
  const exists = useQuery({
    queryKey: ['exists', slug, candidates.join('\n'), runCount],
    queryFn: () => api.filesExist(slug, candidates.slice(0, 200)),
    enabled: candidates.length > 0,
    staleTime: 60_000,
  });
  const filePaths = useMemo<FilePathsValue>(() => {
    const found = new Map<string, string>();
    for (const [written, hit] of Object.entries(exists.data?.results ?? {})) if (hit?.kind === 'file') found.set(written, hit.path);
    return {
      found, open: (path) => { setPreviewPath(path); setPanel(true); }, slug,
      mounts: mounts ? { root: mounts.files?.workspaceRoot ?? null } : null,
    };
  }, [exists.data, slug, mounts]);
  const cited = useMemo(() => [...new Set(filePaths.found.values())], [filePaths]);

  const upload = useCallback<Upload>(async (file) => {
    const [done] = await uploadFiles(slug, 'inbox', [file]);
    void qc.invalidateQueries({ queryKey: ['tree', slug] });
    return { agentPath: done!.agentPath, url: rawUrl(slug, done!.path) };
  }, [slug, qc]);
  const addFiles = (f: File[]) => composer.current?.addFiles(f);

  const side = previewPath ? (
    <Preview scope={workspaceScope(slug)} path={previewPath} onClose={() => setPreviewPath(null)} />
  ) : (
    <SessionFiles inst={inst ?? ''} slug={slug} sessionId={sessionId} onDrop={addFiles} cited={cited} runKey={runCount} onOpen={setPreviewPath} onClose={() => setPanel(false)} />
  );

  return (
    <FilePaths.Provider value={filePaths}>
    <div className="flex min-h-full">
    <DropZone onFiles={addFiles} label="Déposer dans inbox/ et joindre au message" className="flex min-h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom))] min-w-0 flex-1 flex-col md:min-h-[var(--content-h)]">
      <header className="sticky top-0 z-10 border-b border-line bg-sheet/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-5 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink-faint">
              <Link to="/w/$slug" params={{ slug }} className="transition-colors hover:text-ink">{ws.data?.workspace.name ?? slug}</Link>
              <span className="mx-1">/</span>
              <span className="font-mono">{sess.data?.profile ?? 'default'}</span>
            </p>
            <h1 className="truncate text-[15px] font-semibold">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" className="size-8 px-0" aria-label="Copier le lien de la session" title="Copier le lien de la session"
              onClick={() => void copyText(window.location.href, 'Lien de la session').then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); })}>
              {linkCopied ? <Check className="size-4" strokeWidth={2} /> : <Link2 className="size-4" strokeWidth={1.5} />}
            </Button>
            <Button variant="ghost" className={cx('size-8 px-0', panel && 'lg:bg-raised lg:text-ink')} aria-label="Fichiers de la session" title="Fichiers de la session"
              aria-expanded={panel} onClick={() => { setPanel(!panel); setPreviewPath(null); }}>
              <PanelRight className="size-4" strokeWidth={1.5} />
            </Button>
            <Menu
              title="Actions de la session"
              trigger={<Ellipsis className="size-4" strokeWidth={1.5} />}
              triggerClass="flex size-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink aria-expanded:bg-raised"
              items={[
                { label: 'Renommer', icon: <Pencil className="size-4" strokeWidth={1.5} />,
                  onSelect: async () => { const t = await askText({ title: 'Renommer la session', label: 'Nouveau titre', value: sess.data?.session.title ?? '', confirmLabel: 'Renommer' }); if (t) rename.mutate(t); } },
                sess.data?.session.pinned
                  ? { label: 'Désépingler', icon: <PinOff className="size-4" strokeWidth={1.5} />, onSelect: () => pin.mutate(false) }
                  : { label: 'Épingler', icon: <Pin className="size-4" strokeWidth={1.5} />, onSelect: () => pin.mutate(true) },
                sess.data?.session.archived
                  ? { label: 'Désarchiver', icon: <ArchiveRestore className="size-4" strokeWidth={1.5} />, onSelect: () => archive.mutate(false) }
                  : { label: 'Archiver', icon: <Archive className="size-4" strokeWidth={1.5} />, disabled: running, onSelect: () => archive.mutate(true) },
                { label: 'Supprimer', icon: <Trash2 className="size-4" strokeWidth={1.5} />, disabled: running, danger: true, onSelect: () => remove.mutate() },
              ]}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-6 md:px-8">
        <div className="mb-6 empty:hidden"><ChatNotice instanceId={inst} /></div>
        {history.isSuccess && entries.length === 0 && !running && !endNote && (
          <div className="py-16 text-center">
            <p className="text-[15px]">Nouvelle session dans {ws.data?.workspace.name}</p>
            <p className="mt-2 text-sm text-ink-soft">L’agent travaille dans le dossier du workspace et range ses fichiers dans celui de la session</p>
          </div>
        )}
        {messages.length >= 500 && <p className="mb-4 text-center text-xs text-ink-faint">Messages plus anciens non affichés</p>}
        {live?.truncated && (
          <p className="mb-4 text-xs text-ink-faint">Le début de ce run n’est plus disponible en direct : il apparaîtra à la fin</p>
        )}
        <Thread entries={entries} footers={footers} agent={agent} />
        {running && !live?.approval && !live?.clarify && <ThinkingIndicator entries={entries} agent={agent} />}
        {live?.approval && (
          <div className="mt-5"><ApprovalCard approval={live.approval} onChoose={approve} busy={busy} /></div>
        )}
        {live?.clarify && (
          <div className="mt-5"><ClarifyCard key={live.clarify.requestId ?? ''} clarify={live.clarify} onAnswer={(t) => void answer(t)} busy={busy} /></div>
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
        <div className="mx-auto max-w-3xl px-5 pb-4 md:px-8 md:pb-6">
          <div className="mb-2 empty:hidden"><ErrorText error={error} /></div>
          <Composer
            ref={composer}
            upload={upload}
            onSend={send}
            onStop={stop}
            running={running}
            disabled={!chat.available || !inst}
            onQueue={(text) => setQueue((q) => enqueue(q, text))}
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
                hasRuns={Boolean(lastRunId)} disabled={running || setOptions.isPending || !chat.available}
                onChange={(patch) => setOptions.mutate(patch)}
              />
            )}
            placeholder={running ? (live?.status === 'waiting_for_approval' ? 'En attente de votre approbation' : live?.status === 'waiting_for_clarify' ? 'Hermes vous pose une question' : 'L’agent travaille… Entrée met votre message en file') : entries.length ? `Répondre à ${agent}…` : `Écrire à ${agent}…`}
            hint={entries.length ? <ContextGauge usage={usage.data} estimate={estimate} />
              : running ? 'Entrée : mettre en file · Réorienter : donner le texte tout de suite' : 'Entrée pour envoyer · Maj+Entrée pour aller à la ligne'}
          />
        </div>
      </div>
    </DropZone>
    {panel && (
      <aside className={cx(
        'fixed inset-0 z-30 bg-sheet lg:sticky lg:top-0 lg:z-auto lg:h-[var(--content-h)] lg:shrink-0 lg:border-l lg:border-line',
        previewPath ? 'lg:w-[min(46vw,640px)]' : 'lg:w-[340px]',
      )}>
        {side}
      </aside>
    )}
    </div>
    </FilePaths.Provider>
  );
}
