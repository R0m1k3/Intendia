import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type SessionSource } from '../api';
import { ListLabel, ListPane } from '../components/Panes';
import { Button, Chips, ErrorText } from '../components/ui';
import { FILTERS } from '../home/labels';
import { useCurrentInstance } from '../instance/current';
import { groupByDay } from './days';
import { SessionRow } from './SessionRow';

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
export function SessionsPane({ openId }: { openId: string | null }) {
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
  const active = searching ? found : list;
  const rows = active.data?.sessions ?? [];
  const groups = groupByDay(rows);
  const partial = searching ? found.data?.partial ?? [] : [];
  const more = !searching && list.data !== undefined && list.data.sessions.length >= limit && limit < MAX;
  const note = 'px-3.5 py-2 text-xs';

  return (
    <ListPane
      title="Sessions"
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
            {g.items.map((s) => <SessionRow key={`${s.instanceId}:${s.id}`} s={s} open={s.id === openId} />)}
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
