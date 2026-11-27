import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { connectAgent } from '../agents/connect';
import { Link, useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Brain, Brush, ChevronRight, KeyRound, Layers, Ellipsis, Folder, FolderPlus, Hash, Inbox, MessageSquareText, PenLine, Plus, Search, SlidersHorizontal, UserRound } from 'lucide-react';
import { NewChannel } from '../channels/NewChannel';
import { useEffect, useMemo, useState } from 'react';
import { api, type RecentSession, type SessionSource } from '../api';
import { ask, askText } from '../components/Dialog';
import { Menu, Picker, PICKER_BTN } from '../components/Menu';
import { NewWorkspace, slugify } from '../components/NewWorkspace';
import { NewAgent } from '../pages/Agents';
import { Empty, ListLabel, ListPane } from '../components/Panes';
import { Button, Chips, cx, ErrorText, SkeletonList } from '../components/ui';
import { FILTERS } from '../home/labels';
import { useCurrentInstance } from '../instance/current';
import { openBeside, updateChat } from '../chat/columns';
import { agentTree, type AgentFilter, type AgentNode, type FolderNode } from './agentTree';
import { runMarks, withMarked, type RunMark } from './running';
import { afterRemoveRoute, useRemoveSession, type RemoveTarget } from './remove';
import { SessionRow } from './SessionRow';
import { invalidateSessionLists, SESSION_LIST_KEYS, showUndo } from './UndoBar';
import { useSeen } from './unread';
import { AgentAvatar, useAgentLooks } from '../agents/look';
import { plural, t } from '../i18n';

/** Sessions read for the column (the server's maximum). */
const LIMIT = 200;
/** Sessions shown in a folder before « n de plus ». */
const FOLDER_ROWS = 6;

const VIEWS: { key: AgentFilter; label: string }[] = [
  { key: 'all', label: t('Tout') },
  { key: 'running', label: t('En cours') },
  { key: 'unread', label: t('Non lus') },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

/** Folded agents and folders of an instance, kept in this browser. */
function useFolded(inst: string | null): [ReadonlySet<string>, (key: string, folded: boolean) => void] {
  const storeKey = `intendia-tree-folded:${inst ?? ''}`;
  const read = () => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(storeKey) ?? '[]') as string[]); } catch { return new Set<string>(); }
  };
  const [set, setSet] = useState<ReadonlySet<string>>(read);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies chosen on purpose (see the comment of this hook)
  useEffect(() => setSet(read()), [storeKey]);
  const toggle = (key: string, folded: boolean) => setSet((prev) => {
    const next = new Set(prev);
    if (folded) next.add(key); else next.delete(key);
    localStorage.setItem(storeKey, JSON.stringify([...next]));
    return next;
  });
  return [set, toggle];
}

/** What the agent is doing, in words (under its name). */
function agentLine(a: AgentNode): { text: string; tone: 'bad' | 'accent' | 'faint' } {
  if (a.state === 'waiting') return { text: t('Attend votre réponse'), tone: 'bad' };
  if (a.state === 'running') return { text: t('Travaille'), tone: 'accent' };
  if (a.state === 'subagents') return { text: t('Ses sous-agents travaillent'), tone: 'accent' };
  if (!a.known) return { text: t('Agent introuvable chez Hermes'), tone: 'faint' };
  if (!a.hasKey) return { text: t('Pas encore connecté à Intendia'), tone: 'faint' };
  return { text: a.description || a.model || t('Prêt'), tone: 'faint' };
}

/**
 * The agents column (replaces the sessions column, OpenBot-like): what waits for you and what works on top, then each
 * agent of the instance with its folders (workspaces) and their sessions, and its other conversations (Telegram, CLI,
 * crons…). A search shows a flat list, as before. Unread = moved since last opened in this browser.
 */
export function AgentsPane({ openId, onBeside }: {
  openId: string | null;
  onBeside?: (slug: string, id: string) => void;
}) {
  const asked = (useSearch({ strict: false }) as { source?: SessionSource }).source;
  const [source, setSource] = useState<SessionSource>(asked ?? 'all');
  useEffect(() => { if (asked) setSource(asked); }, [asked]);
  const [view, setView] = useState<AgentFilter>('all');
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const searching = q.length >= 2;
  const { id: inst, instance } = useCurrentInstance();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const list = useQuery({
    queryKey: ['sessions-list', inst, source, LIMIT], queryFn: () => api.recentSessions(inst!, LIMIT, source),
    enabled: !searching && inst !== null, placeholderData: keepPreviousData, refetchOnWindowFocus: false,
  });
  const found = useQuery({
    queryKey: ['sessions-search', inst, source, q], queryFn: () => api.searchSessions(inst!, q, source),
    enabled: searching && inst !== null, refetchOnWindowFocus: false,
  });
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst!).then((r) => r.agents), enabled: inst !== null, staleTime: 60_000, retry: false });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const activity = useQuery({ queryKey: ['activity', inst], queryFn: () => api.activity(inst!), enabled: inst !== null, refetchInterval: 5_000, staleTime: 0 });
  const feed = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), enabled: inst !== null, refetchInterval: 5_000 });
  const marks: Map<string, RunMark> = inst ? runMarks(activity.data?.runs ?? [], feed.data?.approvals ?? [], inst, activity.data?.subagents ?? []) : new Map();
  const unused = useQuery({ queryKey: ['sessions-cleanup', inst], queryFn: () => api.cleanupInfo(inst!), enabled: inst !== null });
  const { isUnread, seen } = useSeen(inst);
  const looks = useAgentLooks(inst);
  const [folded, setFolded] = useFolded(inst);
  const [more, setMore] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<unknown>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);
  // channels are shared by every instance (their members may come from several)
  const channelList = useQuery({ queryKey: ['channels'], queryFn: api.channels, refetchInterval: 10_000, retry: false });
  const channelOpen = /^\/canaux\/([^/]+)/.exec(useRouterState({ select: (s) => s.location.pathname }))?.[1] ?? null;
  const rm = useRemoveSession();

  const rows = (searching ? found.data?.sessions : list.data?.sessions) ?? [];
  // the open session is read, and stays read while it moves
  const openAt = rows.find((s) => s.id === openId)?.at;
  useEffect(() => { if (openId && openAt) seen(openId, openAt); }, [openId, openAt, seen]);

  const mine = useMemo(() => (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === inst), [workspaces.data, inst]);
  // a session that works or waits shows even beyond the 200 loaded ones
  const loaded = inst ? withMarked(list.data?.sessions ?? [], marks, inst, source === 'all' || source === 'intendia') : [];
  const tree = agentTree({ sessions: loaded, agents: agents.data, workspaces: mine, marks, isUnread, filter: view });

  const removeRow = async (s: RecentSession) => {
    const target: RemoveTarget = { kind: s.kind, inst: s.instanceId, profile: s.profile, id: s.id, slug: s.workspace ?? undefined };
    setError(null);
    try {
      const res = await rm.remove(target);
      if (res && s.id === openId) await navigate({ ...afterRemoveRoute(res.chat, target), replace: true });
    } catch (err) {
      setError(err);
    }
  };
  const n = unused.data?.unused ?? 0;
  const cleanUp = async () => {
    if (!inst) return;
    const ok = await ask({
      title: t('Faire le ménage ?'), danger: true, confirmLabel: t('Supprimer'),
      message: plural(n, '{n} session jamais utilisée dans Intendia, créée il y a plus d’une heure. Les sessions des autres sources ne sont pas touchées.', '{n} sessions jamais utilisées dans Intendia, créées il y a plus d’une heure. Les sessions des autres sources ne sont pas touchées.'),
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await api.cleanup(inst);
      if (res.ids.length) showUndo({ inst, ids: res.ids, undoUntil: res.undoUntil, label: plural(res.ids.length, '{n} session supprimée', '{n} sessions supprimées') });
    } catch (err) {
      setError(err);
    }
    await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
  };

  /** A new session in a folder with `agent`, opened beside the active chat (as « Nouvelle session »). */
  const newIn = async (slug: string, agent: string) => {
    setError(null);
    try {
      const { session } = await api.createSession(slug);
      // a folder of another agent (one of this agent's sessions lives there): the new session keeps this agent
      const owner = mine.find((w) => w.slug === slug)?.profile ?? 'default';
      if (inst && owner !== agent) await api.updateSession(inst, session.id, { profile: agent });
      localStorage.setItem('intendia-last-workspace', slug);
      void invalidateSessionLists(qc);
      updateChat((c) => openBeside(c, { slug, id: session.id }));
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
    } catch (err) {
      setError(err);
    }
  };
  /** A new folder (workspace) of an agent; returns its slug. */
  const newFolder = async (agent: string): Promise<string | null> => {
    if (!inst) return null;
    const name = await askText({ title: t('Nouveau dossier de {agent}', { agent }), label: t('Nom du dossier'), maxLength: 60, confirmLabel: t('Créer') });
    if (!name?.trim()) return null;
    setError(null);
    try {
      const { workspace } = await api.createWorkspace({ slug: slugify(name), name: name.trim(), instanceId: inst, profile: agent });
      await qc.invalidateQueries({ queryKey: ['workspaces'] });
      return workspace.slug;
    } catch (err) {
      setError(err);
      return null;
    }
  };
  /** A new session with an agent: in its most recent own folder, else in a new one. */
  const newWith = async (a: AgentNode) => {
    if (!a.hasKey && inst) {
      setError(null);
      try {
        if (!(await connectAgent(qc, inst, a.name))) return;
      } catch (err) {
        setError(err);
        return;
      }
    }
    const own = a.folders.find((f) => (f.workspace.profile ?? 'default') === a.name);
    const slug = own?.workspace.slug ?? await newFolder(a.name);
    if (slug) await newIn(slug, a.name);
  };

  const row = (s: RecentSession, compact: boolean) => (
    <SessionRow key={`${s.instanceId}:${s.id}`} s={s} open={s.id === openId} onBeside={onBeside} compact={compact}
      run={marks.get(s.id)?.state} subagents={marks.get(s.id)?.subagents} unread={s.id !== openId && isUnread(s)}
      onRemove={() => void removeRow(s)} busy={rm.pending.has(s.id)} />
  );
  const group = (label: string, items: RecentSession[], key: string) => items.length > 0 && (
    <div key={key} role="group" aria-label={label} data-group={key}>
      <ListLabel>{label}</ListLabel>
      <ul className="flex flex-col gap-0.5">{items.map((s) => row(s, false))}</ul>
    </div>
  );
  const forced = view !== 'all';
  const sessionsOf = (key: string, items: RecentSession[]) => {
    const all = more.has(key) || forced;
    const shown = all ? items : items.slice(0, FOLDER_ROWS);
    return (
      <ul className="ml-[22px] flex flex-col gap-px border-l border-line/80 pl-1.5">
        {shown.map((s) => row(s, true))}
        {items.length > shown.length && (
          <li>
            <button type="button" onClick={() => setMore((m) => new Set(m).add(key))}
              className="w-full rounded-lg px-3 py-1 text-left text-[12.5px] text-ink-faint hover:bg-paper hover:text-ink">
              {plural(items.length - shown.length, '{n} de plus', '{n} de plus')}
            </button>
          </li>
        )}
      </ul>
    );
  };
  const folderRow = (a: AgentNode, f: FolderNode) => {
    const key = `f:${a.name}/${f.workspace.slug}`;
    const open = forced || !folded.has(key);
    const unread = f.sessions.filter((s) => s.id !== openId && isUnread(s)).length;
    return (
      <li key={key} data-folder={f.workspace.slug}>
        <div className="group/f flex items-center gap-1 rounded-lg pr-1 hover:bg-paper">
          <button type="button" onClick={() => setFolded(key, open)} aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1.5 text-left text-[13px] text-ink-soft">
            <ChevronRight className={cx('size-3.5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} strokeWidth={1.75} />
            <Folder className="size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="min-w-0 flex-1 truncate">{f.workspace.name}</span>
            {unread > 0 && <span className="shrink-0 rounded-full bg-accent-soft px-1.5 font-mono text-[10.5px] text-accent-ink" aria-label={plural(unread, '{n} non lu', '{n} non lus')}>{unread}</span>}
          </button>
          <button type="button" onClick={() => void newIn(f.workspace.slug, a.name)} title={t('Nouvelle session dans {folder}', { folder: f.workspace.name })}
            aria-label={t('Nouvelle session dans {folder}', { folder: f.workspace.name })}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-raised hover:text-ink md:invisible md:group-hover/f:visible md:group-focus-within/f:visible">
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
        {open && (f.sessions.length > 0 ? sessionsOf(key, f.sessions) : (
          <p className="ml-[22px] border-l border-line/80 py-1 pl-4 text-[12.5px] text-ink-faint">{t('Aucune session')}</p>
        ))}
      </li>
    );
  };
  const agentBlock = (a: AgentNode) => {
    const key = `a:${a.name}`;
    const open = forced || !folded.has(key);
    const line = agentLine(a);
    const othersKey = `o:${a.name}`;
    // other conversations (Telegram, CLI, crons…) start folded: they are often many
    const othersOpen = forced || folded.has(`${othersKey}:open`);
    return (
      <li key={key} data-agent={a.name} className="pt-1">
        <div className="group/a flex items-center gap-1 rounded-[10px] pr-1 hover:bg-paper">
          <button type="button" onClick={() => setFolded(key, open)} aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
            <span className="relative">
              <AgentAvatar name={a.name} color={looks.color(a.name)} />
              {a.state && <span className={cx('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-sheet', a.state === 'waiting' ? 'bg-bad' : 'animate-pulse bg-accent')} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold leading-5">{a.name}</span>
              <span className={cx('block truncate text-[12px] leading-4', line.tone === 'bad' ? 'font-medium text-bad' : line.tone === 'accent' ? 'font-medium text-accent-ink' : 'text-ink-faint')}>{line.text}</span>
            </span>
            {a.unread > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 font-mono text-[11px] font-medium leading-[18px] text-on-accent" aria-label={plural(a.unread, '{n} non lu', '{n} non lus')}>{a.unread}</span>}
          </button>
          <Menu
            title={t('Agent {name}', { name: a.name })} align="end"
            triggerClass="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-raised hover:text-ink aria-expanded:bg-raised md:invisible md:group-hover/a:visible md:group-focus-within/a:visible md:aria-expanded:visible"
            trigger={<><Ellipsis className="size-4" strokeWidth={1.5} /><span className="sr-only">{t('Actions de l’agent {name}', { name: a.name })}</span></>}
            items={[
              ...(a.hasKey || a.known ? [{ label: t('Nouvelle session'), icon: <PenLine className="size-4" strokeWidth={1.5} />, onSelect: () => void newWith(a) }] : []),
              { label: t('Nouveau dossier'), icon: <FolderPlus className="size-4" strokeWidth={1.5} />, onSelect: () => void newFolder(a.name) },
              ...(a.known && inst ? [{ label: t('Fiche de l’agent'), icon: <UserRound className="size-4" strokeWidth={1.5} />, onSelect: () => void navigate({ to: '/i/$inst/agents/$name', params: { inst, name: a.name } }) }] : []),
              ...(a.known && inst ? [{ label: t('Réglages de l’agent'), icon: <SlidersHorizontal className="size-4" strokeWidth={1.5} />, onSelect: () => void navigate({ to: '/i/$inst/config', params: { inst }, search: { profile: a.isDefault ? undefined : a.name } } as never) }] : []),
              ...(a.known && inst ? ([['skills', t('Skills'), Layers], ['memoire', t('Mémoire'), Brain], ['acces', t('Accès'), KeyRound]] as const).map(([page, label, Icon]) => ({
                label, icon: <Icon className="size-4" strokeWidth={1.5} />,
                onSelect: () => void navigate({ to: `/i/$inst/${page}`, params: { inst }, search: { profile: a.isDefault ? undefined : a.name } } as never),
              })) : []),
            ]}
          />
        </div>
        {open && (
          <ul className="mt-0.5 flex flex-col gap-px pl-2">
            {a.folders.map((f) => folderRow(a, f))}
            {a.others.length > 0 && (
              <li data-folder="others">
                <button type="button" onClick={() => setFolded(`${othersKey}:open`, !othersOpen)} aria-expanded={othersOpen}
                  className="flex w-full items-center gap-1.5 rounded-lg py-1 pl-1.5 pr-2 text-left text-[13px] text-ink-soft hover:bg-paper">
                  <ChevronRight className={cx('size-3.5 shrink-0 text-ink-faint transition-transform', othersOpen && 'rotate-90')} strokeWidth={1.75} />
                  <Inbox className="size-3.5 shrink-0" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate">{t('Autres conversations')}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">{a.others.length}</span>
                </button>
                {othersOpen && sessionsOf(othersKey, a.others)}
              </li>
            )}
            {a.folders.length === 0 && a.others.length === 0 && (
              <li className="py-1 pl-6 text-[12.5px] text-ink-faint">{t('Aucune conversation')}</li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const searchRows = found.data?.sessions ?? [];
  const nothing = !searching && list.isSuccess && tree.agents.length === 0;
  const note = 'px-3.5 py-2 text-xs';

  return (
    <ListPane
      title={<span className="flex items-center gap-2"><span className="truncate">{instance?.label ?? t('Agents')}</span></span>}
      action={(
        <>
          {n > 0 && (
            <Button variant="ghost" className="h-8 px-2" onClick={() => void cleanUp()} title={t('Supprimer les sessions jamais utilisées')} aria-label={t('Ménage ({n})', { n })}>
              <Brush className="size-4" strokeWidth={1.5} /><span className="font-mono text-[11px]">{n}</span>
            </Button>
          )}
          <Menu
            title={t('Créer')} align="end"
            triggerClass="flex size-8 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-raised hover:text-ink aria-expanded:bg-raised"
            trigger={<><Plus className="size-4" strokeWidth={1.75} /><span className="sr-only">{t('Créer')}</span></>}
            items={[
              { label: t('Nouvelle session'), icon: <PenLine className="size-4" strokeWidth={1.5} />, onSelect: () => void navigate({ to: '/chat/nouvelle' }) },
              { label: t('Nouveau dossier…'), icon: <FolderPlus className="size-4" strokeWidth={1.5} />, onSelect: () => setAddingFolder(true) },
              { label: t('Nouvel agent…'), icon: <UserRound className="size-4" strokeWidth={1.5} />, onSelect: () => setAddingAgent(true) },
              { label: t('Nouveau canal…'), icon: <Hash className="size-4" strokeWidth={1.5} />, onSelect: () => setAddingChannel(true) },
            ]}
          />
        </>
      )}
      head={(
        <>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 text-ink-faint focus-within:border-ink">
            <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="sr-only">{t('Rechercher dans les sessions')}</span>
            <input
              type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Rechercher un titre ou un mot')}
              className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <div className="flex items-center gap-1">
            <Chips label={t('Afficher')} items={VIEWS} value={view} onChange={setView} className="min-w-0 flex-1" />
            <Picker
              title={t('Source')} placement="below" value={source} onPick={(v) => setSource((v ?? 'all') as SessionSource)}
              items={FILTERS.map((f) => ({ value: f.key, label: f.label }))}
              label={<span className="inline-flex items-center gap-1 whitespace-nowrap">{source === 'all' ? t('Source') : FILTERS.find((f) => f.key === source)?.label}<ChevronRight className="size-3 rotate-90" strokeWidth={1.75} /></span>}
              triggerClass={cx(PICKER_BTN, 'shrink-0 whitespace-nowrap', source !== 'all' && '!bg-accent-soft !text-accent-ink')}
            />
          </div>
        </>
      )}
    >
      {addingAgent && inst && (
        <NewAgent inst={inst} agents={agents.data ?? []} onClose={() => setAddingAgent(false)}
          onCreated={(name, _source, modelError) => {
            setAddingAgent(false);
            void navigate({ to: '/i/$inst/agents/$name', params: { inst, name } });
            // Hermes made the agent but refused the model: say it, the card does not keep this error
            if (modelError) void ask({ title: t('Agent créé, modèle non appliqué'), message: t('Modèle non appliqué : {error}', { error: modelError }), confirmLabel: t('Compris') });
          }} />
      )}
      {addingChannel && (
        <NewChannel onClose={() => setAddingChannel(false)}
          onCreated={(id) => { setAddingChannel(false); void navigate({ to: '/canaux/$channelId', params: { channelId: id } }); }} />
      )}
      {addingFolder && (
        <div className="m-1.5 rounded-xl border border-line p-3">
          <NewWorkspace onCancel={() => setAddingFolder(false)} onCreated={() => { setAddingFolder(false); void qc.invalidateQueries({ queryKey: ['workspaces'] }); }} />
        </div>
      )}
      <ErrorText error={(searching ? found : list).error} />
      <ErrorText error={error} />
      {(searching ? found.data?.errors : list.data?.errors)?.map((e) => (
        <p key={e.instance} className={`${note} text-bad`} title={e.message}>{t('{instance} : injoignable', { instance: e.instance })}</p>
      ))}
      {searching ? (
        <>
          {(found.data?.partial ?? []).map((name) => (
            <p key={name} data-partial className={`${note} text-ink-soft`}>
              {t('Recherche dans le contenu indisponible sur {name} : seuls les titres des sessions Intendia y sont cherchés', { name })}
            </p>
          ))}
          <ul className="flex flex-col gap-0.5">{searchRows.map((s) => row(s, false))}</ul>
          {found.isSuccess && searchRows.length === 0 && <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Aucune session ne contient « {q} »', { q })}</p>}
          {found.isSuccess && searchRows.length >= 30 && <p className={`${note} text-ink-faint`}>{t('Les 30 premiers résultats : précisez la recherche pour en voir d’autres')}</p>}
          {found.isFetching && searchRows.length === 0 && <SkeletonList rows={6} />}
        </>
      ) : (
        <>
          {group(t('Vous attend'), tree.needsYou, 'needs-you')}
          {group(t('En cours'), tree.working, 'working')}
          {view === 'all' && group(t('Épinglées'), tree.pinned, 'pinned')}
          {view === 'all' && (channelList.data?.channels.length ?? 0) > 0 && (
            <div role="group" aria-label={t('Canaux')} data-group="channels">
              <ListLabel>{t('Canaux')}</ListLabel>
              <ul className="flex flex-col gap-0.5">
                {channelList.data!.channels.map((ch) => (
                  <li key={ch.id}>
                    <Link to="/canaux/$channelId" params={{ channelId: ch.id }} data-channel-row={ch.id}
                      className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-paper', channelOpen === ch.id && 'bg-accent-soft')}>
                      <Hash className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
                      <span className="min-w-0 flex-1 truncate">{ch.name}</span>
                      {ch.stopped ? <span className="text-xs text-warn">{t('arrêté')}</span>
                        : ch.busy ? <span className="size-1.5 rounded-full bg-accent" aria-label={t('En cours')} />
                          : <span className="font-mono text-[11px] text-ink-faint">{ch.members.length}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tree.agents.length > 0 && (
            <div role="group" aria-label={t('Agents')}>
              <ListLabel>{t('Agents')}</ListLabel>
              <ul className="flex flex-col">{tree.agents.map(agentBlock)}</ul>
            </div>
          )}
          <ErrorText error={agents.error} />
          {nothing && (view === 'all' && source === 'all' ? (
            <Empty icon={<MessageSquareText strokeWidth={1.5} />} title={t('Aucune session pour l’instant')}
              actions={<Button variant="primary" onClick={() => void navigate({ to: '/chat/nouvelle' })}><PenLine className="size-4" strokeWidth={1.5} />{t('Nouvelle session')}</Button>} />
          ) : (
            <p className="px-3.5 py-6 text-sm text-ink-faint">{view === 'running' ? t('Aucun agent ne travaille') : view === 'unread' ? t('Tout est lu') : t('Aucune session de cette source')}</p>
          ))}
          {list.isPending && inst !== null && <SkeletonList rows={6} />}
          {inst && <Link to="/i/$inst/agents" params={{ inst }} className="mx-1.5 mt-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-faint hover:bg-paper hover:text-ink">
            <UserRound className="size-3.5" strokeWidth={1.5} />{t('Gérer les agents')}
          </Link>}
        </>
      )}
    </ListPane>
  );
}

