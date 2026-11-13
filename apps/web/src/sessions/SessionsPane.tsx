import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Brush, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RecentSession, type SessionSource } from '../api';
import { ask } from '../components/Dialog';
import { ListLabel, ListPane } from '../components/Panes';
import { Button, Chips, ErrorText } from '../components/ui';
import { FILTERS } from '../home/labels';
import { useCurrentInstance } from '../instance/current';
import { sessionsCount } from './actions';
import { groupByDay } from './days';
import { runMarks, withRunning } from './running';
import { afterRemoveRoute, useRemoveSession, type RemoveTarget } from './remove';
import { SessionRow } from './SessionRow';
import { SESSION_LIST_KEYS, showUndo } from './UndoBar';

const PAGE = 50;
const MAX = 200;

/** The value after a pause in typing. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The inbox column: every session of the current instance (Intendia and Hermes) by day, a source filter and a search
 * in the history. Its state is local and survives opening a session (the column stays mounted, see InboxLayout);
 * `/?source=` sets the filter.
 */
export function SessionsPane({ openId, onBeside }: {
  openId: string | null;
  /** Chat page: Ctrl/Cmd + click and « Ouvrir à côté » open a session in another column */
  onBeside?: (slug: string, id: string) => void;
}) {
  const asked = (useSearch({ strict: false }) as { source?: SessionSource }).source;
  const [source, setSource] = useState<SessionSource>(asked ?? 'all');
  useEffect(() => { if (asked) setSource(asked); }, [asked]);
  const [limit, setLimit] = useState(PAGE);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const searching = q.length >= 2;
  useEffect(() => setLimit(PAGE), [source]);

  const { id: inst } = useCurrentInstance();
  const list = useQuery({
    queryKey: ['sessions-list', inst, source, limit], queryFn: () => api.recentSessions(inst!, limit, source),
    enabled: !searching && inst !== null, placeholderData: keepPreviousData, refetchOnWindowFocus: false,
  });
  const found = useQuery({
    queryKey: ['sessions-search', inst, source, q], queryFn: () => api.searchSessions(inst!, q, source),
    enabled: searching && inst !== null, refetchOnWindowFocus: false,
  });
  const qc = useQueryClient();
  // sessions whose agent works (or waits for the user): an « En cours » group on top (sessions/running.ts)
  const activity = useQuery({ queryKey: ['activity', inst], queryFn: () => api.activity(inst!), enabled: inst !== null, refetchInterval: 5_000, staleTime: 0 });
  const feed = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), enabled: inst !== null, refetchInterval: 5_000 });
  const marks = inst ? runMarks(activity.data?.runs ?? [], feed.data?.approvals ?? [], inst, activity.data?.subagents ?? []) : new Map();
  const unused = useQuery({ queryKey: ['sessions-cleanup', inst], queryFn: () => api.cleanupInfo(inst!), enabled: inst !== null });
  const [cleanError, setCleanError] = useState<unknown>(null);
  const navigate = useNavigate();
  const rm = useRemoveSession();
  const [removeError, setRemoveError] = useState<unknown>(null);
  /** The row's trash: an Intendia session with « Annuler », one born elsewhere after a confirmation. */
  const removeRow = async (s: RecentSession) => {
    const target: RemoveTarget = { kind: s.kind, inst: s.instanceId, profile: s.profile, id: s.id, slug: s.workspace ?? undefined };
    setRemoveError(null);
    try {
      const res = await rm.remove(target);
      if (res && s.id === openId) await navigate({ ...afterRemoveRoute(res.chat, target), replace: true });
    } catch (err) {
      setRemoveError(err);
    }
  };
  const n = unused.data?.unused ?? 0;
  /** Never used Intendia sessions (nothing at Hermes), deleted with the same undo as a deletion. */
  const cleanUp = async () => {
    if (!inst) return;
    const ok = await ask({
      title: 'Faire le ménage ?', danger: true, confirmLabel: 'Supprimer',
      message: `${sessionsCount(n)} jamais utilisée${n > 1 ? 's' : ''} dans Intendia, créée${n > 1 ? 's' : ''} il y a plus d’une heure. Les sessions des autres sources ne sont pas touchées.`,
    });
    if (!ok) return;
    setCleanError(null);
    try {
      const res = await api.cleanup(inst);
      if (res.ids.length) showUndo({ inst, ids: res.ids, undoUntil: res.undoUntil, label: `${sessionsCount(res.ids.length)} supprimée${res.ids.length > 1 ? 's' : ''}` });
    } catch (err) {
      setCleanError(err);
    }
    await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
  };
  const active = searching ? found : list;
  const rows = active.data?.sessions ?? [];
  const byDay = groupByDay(rows);
  const groups = searching || !inst ? byDay : withRunning(byDay, marks, inst, source === 'all' || source === 'intendia');
  const partial = searching ? found.data?.partial ?? [] : [];
  const more = !searching && list.data !== undefined && list.data.sessions.length >= limit && limit < MAX;
  const note = 'px-3.5 py-2 text-xs';

  return (
    <ListPane
      title="Sessions"
      action={n > 0 ? (
        <Button variant="ghost" onClick={() => void cleanUp()} title="Supprimer les sessions jamais utilisées">
          <Brush className="size-4" strokeWidth={1.5} />Ménage ({n})
        </Button>
      ) : undefined}
      head={(
        <>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 text-ink-faint focus-within:border-ink">
            <Search className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="sr-only">Rechercher dans les sessions</span>
            <input
              type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Rechercher un titre ou un mot"
              className="w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
          <Chips label="Source" items={FILTERS} value={source} onChange={setSource} />
        </>
      )}
    >
      <ErrorText error={active.error} />
      <ErrorText error={cleanError} />
      <ErrorText error={removeError} />
      {partial.map((name) => (
        <p key={name} data-partial className={`${note} text-ink-soft`}>
          Recherche dans le contenu indisponible sur {name} : seuls les titres des sessions Intendia y sont cherchés
        </p>
      ))}
      {active.data?.errors.map((e) => (
        <p key={e.instance} className={`${note} text-bad`} title={e.message}>{e.instance} : injoignable</p>
      ))}
      {groups.map((g) => (
        <div key={g.label} role="group" aria-label={g.label}>
          <ListLabel>{g.label}</ListLabel>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((s) => <SessionRow key={`${s.instanceId}:${s.id}`} s={s} open={s.id === openId} onBeside={onBeside} run={s.instanceId === inst ? marks.get(s.id)?.state : undefined} subagents={s.instanceId === inst ? marks.get(s.id)?.subagents : undefined}
              onRemove={() => void removeRow(s)} busy={rm.pending.has(s.id)} />)}
          </ul>
        </div>
      ))}
      {active.isSuccess && rows.length === 0 && (
        <p className="px-3.5 py-6 text-sm text-ink-faint">
          {searching ? `Aucune session ne contient « ${q} »` : source === 'all' ? 'Aucune session pour l’instant' : 'Aucune session de cette source'}
        </p>
      )}
      {(active.isPending || (searching && found.isFetching)) && rows.length === 0 && inst !== null && (
        <p className="px-3.5 py-6 text-sm text-ink-faint">Chargement…</p>
      )}
      {searching && found.isSuccess && rows.length >= 30 && (
        <p className={`${note} text-ink-faint`}>Les 30 premiers résultats : précisez la recherche pour en voir d’autres</p>
      )}
      {more && (
        <div className="px-1.5 pt-2">
          <Button variant="ghost" className="w-full" onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))} disabled={list.isFetching}>
            {list.isFetching ? 'Chargement…' : 'Afficher plus'}
          </Button>
        </div>
      )}
    </ListPane>
  );
}
