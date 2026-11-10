import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, type RecentSession } from '../api';
import { cx, ErrorText, timeAgo } from '../components/ui';
import { FILTERS, filterRecent, sourceLabel, type RecentFilter } from './labels';

const TAG: Record<string, string> = {
  intendia: 'bg-accent/10 text-accent',
  telegram: 'bg-ok-soft text-ink',
  cron: 'bg-warn-soft text-ink',
};

/** "il y a 6 h" within a day, else the date ("9 nov."). */
function when(at: number, now = Date.now()): string {
  if (!at) return '';
  if (now - at < 24 * 3600_000) return timeAgo(at);
  return new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function Row({ s }: { s: RecentSession }) {
  const body = (
    <>
      <span className={cx('w-[4.5rem] shrink-0 truncate rounded-md px-1.5 py-0.5 text-center font-mono text-[11px]', TAG[s.source ?? ''] ?? 'bg-raised text-ink-soft')}>
        {sourceLabel(s.source)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{s.title}</span>
        <span className="block truncate text-xs text-ink-faint">{s.sub}</span>
      </span>
      <span className="shrink-0 text-xs text-ink-faint">{when(s.at)}</span>
    </>
  );
  const cls = 'flex min-w-0 items-center gap-3 px-5 py-3 transition-colors hover:bg-raised/50';
  return (
    <li data-recent={s.source ?? 'hermes'}>
      {s.kind === 'intendia' && s.workspace ? (
        <Link to="/w/$slug/s/$sessionId" params={{ slug: s.workspace, sessionId: s.id }} className={cls}>{body}</Link>
      ) : (
        <Link to="/i/$inst/p/$profile/s/$sessionId" params={{ inst: s.instanceId, profile: s.profile, sessionId: s.id }} className={cls}>{body}</Link>
      )}
    </li>
  );
}

/** The latest sessions of every source (Intendia, Telegram, crons…), filtered by source. */
export function RecentSessions() {
  const [filter, setFilter] = useState<RecentFilter>('all');
  const recent = useQuery({ queryKey: ['sessions-recent'], queryFn: () => api.recentSessions(20), refetchInterval: 60_000, refetchOnWindowFocus: false });
  const list = filterRecent(recent.data?.sessions ?? [], filter);
  return (
    <section className="overflow-hidden card" aria-labelledby="recent-title">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 id="recent-title" className="text-[15px] font-semibold">Sessions récentes</h2>
        <div role="radiogroup" aria-label="Source" className="inline-flex gap-0.5 rounded-[9px] bg-raised p-[3px]">
          {FILTERS.map((f) => (
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
        <ul className="divide-y divide-line border-t border-line">{list.map((s) => <Row key={`${s.instanceId}:${s.id}`} s={s} />)}</ul>
      ) : recent.isSuccess ? (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-soft">Aucune session {filter === 'all' ? 'pour l’instant' : 'de cette source'}</p>
      ) : null}
      {recent.data?.errors.map((e) => (
        <p key={e.instance} className="border-t border-line px-5 py-2 text-xs text-bad" title={e.message}>{e.instance} : injoignable</p>
      ))}
      <footer className="border-t border-line px-5 py-3">
        <Link to="/w" className="text-[13px] font-medium text-accent hover:underline">Voir toutes les sessions</Link>
      </footer>
    </section>
  );
}
