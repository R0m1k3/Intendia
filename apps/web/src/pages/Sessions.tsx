import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Brush, Search } from 'lucide-react';
import { ask } from '../components/Dialog';
import { sessionsCount } from '../sessions/actions';
import { SESSION_LIST_KEYS, showUndo } from '../sessions/UndoBar';
import { useEffect, useState } from 'react';
import { api, type SessionSource } from '../api';
import { useCurrentInstance } from '../instance/current';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText } from '../components/ui';
import { FILTERS } from '../home/labels';
import { groupByDay } from '../sessions/days';
import { SessionRow } from '../sessions/SessionRow';

export interface SessionsSearch { source?: SessionSource }

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

/** Every session (Intendia and Hermes), by day, filtered by source on the server, with a search in the history. */
export function SessionsPage() {
  const search = useSearch({ strict: false }) as SessionsSearch;
  const navigate = useNavigate();
  const source: SessionSource = search.source ?? 'all';
  const [limit, setLimit] = useState(PAGE);
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const searching = q.length >= 2;
  useEffect(() => setLimit(PAGE), [source]);

  const { id: inst, instance, instances } = useCurrentInstance();
  const list = useQuery({
    queryKey: ['sessions-list', inst, source, limit], queryFn: () => api.recentSessions(inst!, limit, source),
    enabled: !searching && inst !== null, placeholderData: keepPreviousData, refetchOnWindowFocus: false,
  });
  const found = useQuery({
    queryKey: ['sessions-search', inst, source, q], queryFn: () => api.searchSessions(inst!, q, source),
    enabled: searching && inst !== null, refetchOnWindowFocus: false,
  });
  const qc = useQueryClient();
  const unused = useQuery({ queryKey: ['sessions-cleanup', inst], queryFn: () => api.cleanupInfo(inst!), enabled: inst !== null });
  const [cleanError, setCleanError] = useState<unknown>(null);
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
  const groups = groupByDay(rows);
  const partial = searching ? found.data?.partial ?? [] : [];
  const more = !searching && list.data !== undefined && list.data.sessions.length >= limit && limit < MAX;

  return (
    <>
      <PageHeader
        title="Sessions" subtitle={`Les sessions d’Intendia, de Telegram et des crons${instance && instances.length > 1 ? ` sur ${instance.label}` : ''}`}
        action={n > 0 ? <Button onClick={() => void cleanUp()}><Brush className="size-4" strokeWidth={1.5} />Ménage ({n})</Button> : undefined}
      />
      <div className="px-5 pb-12 md:px-8">
        <section className="overflow-hidden card" aria-label="Sessions">
          <header className="flex flex-wrap items-center gap-3 px-5 py-4">
            <label className="relative min-w-[12rem] flex-1">
              <span className="sr-only">Rechercher dans les sessions</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" strokeWidth={1.5} aria-hidden />
              <input
                type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Rechercher un titre ou un mot d’un message"
                className="h-9 w-full rounded-lg border border-line bg-sheet pl-9 pr-3 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <div role="radiogroup" aria-label="Source" className="inline-flex gap-0.5 rounded-[9px] bg-raised p-[3px]">
              {FILTERS.map((f) => (
                <button
                  key={f.key} type="button" role="radio" aria-checked={source === f.key}
                  onClick={() => void navigate({ to: '/sessions', search: f.key === 'all' ? {} : { source: f.key }, replace: true })}
                  className={cx('h-[26px] rounded-md px-2.5 text-xs font-medium transition-colors', source === f.key ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(22_24_27/0.08)]' : 'text-ink-soft hover:text-ink')}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </header>
          <ErrorText error={active.error} />
          <ErrorText error={cleanError} />
          {partial.map((name) => (
            <p key={name} data-partial className="border-t border-line px-5 py-2 text-xs text-ink-soft">
              Recherche dans le contenu indisponible sur {name} : seuls les titres des sessions Intendia y sont cherchés
            </p>
          ))}
          {active.data?.errors.map((e) => (
            <p key={e.instance} className="border-t border-line px-5 py-2 text-xs text-bad" title={e.message}>{e.instance} : injoignable</p>
          ))}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label}>
              <h2 className="border-t border-line bg-raised/40 px-5 py-1.5 text-xs font-medium text-ink-soft">{g.label}</h2>
              <ul className="divide-y divide-line border-t border-line">
                {g.items.map((s) => <SessionRow key={`${s.instanceId}:${s.id}`} s={s} time />)}
              </ul>
            </div>
          ))}
          {active.isSuccess && rows.length === 0 && (
            <p className="border-t border-line px-5 py-6 text-sm text-ink-soft">
              {searching ? `Aucune session ne contient « ${q} »` : source === 'all' ? 'Aucune session pour l’instant' : 'Aucune session de cette source'}
            </p>
          )}
          {(active.isPending || (searching && found.isFetching)) && rows.length === 0 && (
            <p className="border-t border-line px-5 py-6 text-sm text-ink-soft">Chargement…</p>
          )}
          {searching && found.isSuccess && rows.length >= 30 && (
            <p className="border-t border-line px-5 py-3 text-xs text-ink-faint">Les 30 premiers résultats : précisez la recherche pour en voir d’autres</p>
          )}
          {more && (
            <footer className="border-t border-line px-5 py-3">
              <Button onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))} disabled={list.isFetching}>
                {list.isFetching ? 'Chargement…' : 'Afficher plus'}
              </Button>
            </footer>
          )}
        </section>
      </div>
    </>
  );
}
