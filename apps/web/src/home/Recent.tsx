import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, type RecentSession } from '../api';
import { cx, ErrorText } from '../components/ui';
import { SessionRow } from '../sessions/SessionRow';
import { HOME_FILTERS, filterRecent, type RecentFilter } from './labels';

/** The latest sessions of the instance, of every source (Intendia, Telegram, crons…), filtered by source. */
export function RecentSessions({ inst }: { inst: string }) {
  const [filter, setFilter] = useState<RecentFilter>('all');
  const recent = useQuery({ queryKey: ['sessions-recent', inst], queryFn: () => api.recentSessions(inst, 20), refetchInterval: 60_000, refetchOnWindowFocus: false });
  const list = filterRecent(recent.data?.sessions ?? [], filter);
  return (
    <section className="overflow-hidden card" aria-labelledby="recent-title">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 id="recent-title" className="text-[15px] font-semibold">Sessions récentes</h2>
        <div role="radiogroup" aria-label="Source" className="inline-flex gap-0.5 rounded-[9px] bg-raised p-[3px]">
          {HOME_FILTERS.map((f) => (
            <button
              key={f.key} type="button" role="radio" aria-checked={filter === f.key} onClick={() => setFilter(f.key)}
              className={cx('h-[26px] rounded-md px-2.5 text-xs font-medium transition-colors', filter === f.key ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(22_24_27/0.08)]' : 'text-ink-soft hover:text-ink')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>
      <ErrorText error={recent.error} />
      {list.length ? (
        <ul className="divide-y divide-line border-t border-line">{list.map((s) => <SessionRow key={`${s.instanceId}:${s.id}`} s={s} />)}</ul>
      ) : recent.isSuccess ? (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-soft">Aucune session {filter === 'all' ? 'pour l’instant' : 'de cette source'}</p>
      ) : null}
      {recent.data?.errors.map((e) => (
        <p key={e.instance} className="border-t border-line px-5 py-2 text-xs text-bad" title={e.message}>{e.instance} : injoignable</p>
      ))}
      <footer className="border-t border-line px-5 py-3">
        <Link to="/sessions" className="text-[13px] font-medium text-accent hover:underline">Voir toutes les sessions</Link>
      </footer>
    </section>
  );
}
