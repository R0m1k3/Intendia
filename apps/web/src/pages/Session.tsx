import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Archive, Check, Ellipsis, Link2, PanelRight, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApprovalChoice, type Effort, type RunStat, type RunStatus } from '../api';
import { historyEntries, isTerminal, mergeHistory, withTrees, type Entry, type RunState } from '../chat/events';
import { Composer, type ComposerHandle } from '../chat/Composer';
import { placeRunStats } from '../chat/format';
import { RunOptions } from '../chat/RunOptions';
import { AGENT_INDENT, ApprovalCard, Thread } from '../chat/Thread';
import { useRun } from '../chat/useRun';
import { ChatNotice, useChatAvailability } from '../components/ChatNotice';
import { SessionFiles } from '../components/SessionFiles';
import { DropZone } from '../files/DropZone';
import { FilePaths, type FilePathsValue } from '../files/FilePaths';
import { findPathCandidates } from '../files/paths';
import { Preview } from '../files/Preview';
import { uploadFiles } from '../files/upload';
import { takeHandoff } from '../home/handoff';
import { Menu } from '../components/Menu';
import { Button, copyText, cx, ErrorText } from '../components/ui';

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
  const [panel, setPanel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [runCount, setRunCount] = useState(0);
  /** Sub-agent trees of the runs that ended on this page (Hermes' history does not keep them). */
  const [trees, setTrees] = useState<Extract<Entry, { kind: 'subagents' }>[]>([]);
  const composer = useRef<ComposerHandle>(null);

  // Reopened during a run (reload, other tab, network cut, sent from the home page): plug back into its stream.
  // A message sent from the home page is shown at once (handoff), and kept on screen if its run failed.
  useEffect(() => {
    const s = lastRun.data;
    if (active || !s || !lastRunId || !inst) return;
    const h = takeHandoff(inst, sessionId, lastRunId);
    const seed: Entry[] = h ? [{ kind: 'user', key: `u-${lastRunId}`, text: h.text, ts: h.ts }] : [];
    if (!isTerminal(s.status)) setActive({ id: lastRunId, createdAt: s.createdAt, seed });
    else if (h && OUTCOME[s.status]) setOutcome({ status: s.status, error: s.error ?? s.output, input: h.text });
  }, [lastRun.data, lastRunId, active, inst, sessionId]);
  // the last workspace used is the home page's starting choice
  useEffect(() => { localStorage.setItem('intendia-last-workspace', slug); }, [slug]);

  const onEnd = useCallback(async (state: RunState) => {
    const tree = state.entries.find((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents');
    if (tree) setTrees((t) => [...t, tree]);
    const input = state.entries.find((e) => e.kind === 'user')?.text ?? null;
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
  const live = useRun(inst ?? '', sessionId, inst ? run : null, onEnd);

  const send = async (text: string): Promise<boolean> => {
    if (!inst) return false;
    setError(null);
    setOutcome(null);
    try {
      const res = await api.send(inst, sessionId, text);
      const status: RunStatus | null = await api.runStatus(inst, sessionId, res.runId).catch(() => null);
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      setActive({ id: res.runId, createdAt: status?.createdAt ?? null, seed: [{ kind: 'user', key: `u-${res.runId}`, text, ts: Date.now() / 1000 }] });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      return true;
    } catch (err) {
      setError(err);
      return false;
    }
  };

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

  const stop = async () => {
    if (!inst || !active) return;
    await api.stop(inst, sessionId, active.id).catch(setError);
  };

  const rename = useMutation({
    mutationFn: (title: string) => api.updateSession(inst!, sessionId, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', inst, sessionId] }).then(() => qc.invalidateQueries({ queryKey: ['sessions'] })),
  });
  const archive = useMutation({
    mutationFn: () => api.updateSession(inst!, sessionId, { archived: true }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['sessions'] }); await navigate({ to: '/w/$slug', params: { slug } }); },
  });
  /** Model / effort of the next messages (also remembered as the workspace's last choice). */
  const setOptions = useMutation({
    mutationFn: (patch: { model?: string | null; effort?: Effort | null }) => api.updateSession(inst!, sessionId, patch),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void qc.invalidateQueries({ queryKey: ['workspace', slug] });
    },
    onError: setError,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSession(inst!, sessionId),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['sessions'] }); await navigate({ to: '/w/$slug', params: { slug } }); },
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

  // Follow the bottom of the thread while it grows, unless the reader scrolled up.
  const bottom = useRef<HTMLDivElement>(null);
  const tail = entries.length + (entries.at(-1) && 'text' in entries.at(-1)! ? (entries.at(-1) as { text: string }).text.length : 0);
  useEffect(() => {
    const main = bottom.current?.closest('main');
    if (!main) return;
    if (main.scrollHeight - main.scrollTop - main.clientHeight < 200 || tail < 2) bottom.current?.scrollIntoView({ block: 'end' });
  }, [tail, live?.approval]);

  const title = sess.data?.session.title || 'Nouvelle session';

  // Paths cited by the assistant and the tools; the server says which exist (one lookup per new set).
  const candidates = useMemo(() => {
    if (!mounts) return [];
    const text = entries.map((e) => (e.kind === 'assistant' ? e.text : e.kind === 'tool' ? `${e.preview ?? ''}\n${e.result ?? ''}` : e.kind === 'subagents' ? e.nodes.map((n) => n.summary ?? '').join('\n') : '')).join('\n');
    return findPathCandidates(text, { agentMount: mounts.agentMount, mount: mounts.mount }).sort();
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
    return { found, open: (path) => { setPreviewPath(path); setPanel(true); } };
  }, [exists.data]);
  const cited = useMemo(() => [...new Set(filePaths.found.values())], [filePaths]);

  const [uploadError, setUploadError] = useState<unknown>(null);
  const attach = async (files: File[]) => {
    setUploadError(null);
    try {
      const done = await uploadFiles(slug, 'inbox', files);
      composer.current?.append(done.map((d) => d.agentPath));
      void qc.invalidateQueries({ queryKey: ['tree', slug] });
    } catch (err) {
      setUploadError(err);
    }
  };

  const side = previewPath ? (
    <Preview slug={slug} path={previewPath} onClose={() => setPreviewPath(null)} />
  ) : (
    <SessionFiles inst={inst ?? ''} slug={slug} sessionId={sessionId} onDrop={(f) => void attach(f)} cited={cited} runKey={runCount} onOpen={setPreviewPath} onClose={() => setPanel(false)} />
  );

  return (
    <FilePaths.Provider value={filePaths}>
    <div className="flex min-h-full">
    <DropZone onFiles={(f) => void attach(f)} label="Déposer dans inbox/ et citer dans le message" className="flex min-h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom))] min-w-0 flex-1 flex-col md:min-h-[var(--content-h)]">
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
                  onSelect: () => { const t = prompt('Nouveau titre', sess.data?.session.title ?? ''); if (t?.trim()) rename.mutate(t.trim()); } },
                { label: 'Archiver', icon: <Archive className="size-4" strokeWidth={1.5} />, disabled: running, onSelect: () => archive.mutate() },
                { label: 'Supprimer', icon: <Trash2 className="size-4" strokeWidth={1.5} />, disabled: running, danger: true,
                  onSelect: () => { if (confirm('Supprimer cette session chez Hermes ? Les fichiers de son dossier restent sur le disque.')) remove.mutate(); } },
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
        <Thread entries={entries} footers={footers} />
        {live?.approval && (
          <div className="mt-5"><ApprovalCard approval={live.approval} onChoose={approve} busy={busy} /></div>
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
          <div className="mb-2 empty:hidden"><ErrorText error={error ?? uploadError} /></div>
          <Composer
            ref={composer}
            onAttach={(f) => void attach(f)}
            onSend={send}
            onStop={stop}
            running={running}
            disabled={!chat.available || !inst}
            options={inst && sess.data && (
              <RunOptions
                inst={inst} profile={sess.data.profile ?? 'default'}
                model={sess.data.session.model} effort={sess.data.session.effort}
                hasRuns={Boolean(lastRunId)} disabled={running || setOptions.isPending || !chat.available}
                onChange={(patch) => setOptions.mutate(patch)}
              />
            )}
            placeholder={running ? (live?.status === 'waiting_for_approval' ? 'En attente de votre approbation' : 'L’agent travaille…') : entries.length ? 'Répondre à Hermes…' : 'Écrire à Hermes…'}
            hint="Entrée pour envoyer · Maj+Entrée pour aller à la ligne"
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
