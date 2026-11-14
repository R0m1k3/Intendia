import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, type PublicInstance } from '../api';
import { Button, Tag, timeAgo } from '../components/ui';
import { t } from '../i18n';

const SOURCE: Record<string, string> = { telegram: 'telegram', cli: 'cli', cron: 'cron', api_server: 'api', discord: 'discord', slack: 'slack' };

/** Sessions of the instance not made by Intendia (Telegram, CLI, crons), read only, per agent. */
export function OtherSessions({ inst }: { inst: PublicInstance }) {
  const [profile, setProfile] = useState('default');
  const q = useInfiniteQuery({
    queryKey: ['other-sessions', inst.id, profile],
    queryFn: ({ pageParam }) => api.otherSessions(inst.id, profile, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.sessions) ?? [];
  return (
    <section className="card overflow-hidden" aria-labelledby="other-sessions">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 id="other-sessions" className="text-[15px] font-semibold">{t('Autres sessions')} <span className="ml-1 text-xs font-normal text-ink-faint">{inst.label}</span></h3>
          <p className="mt-0.5 text-[13px] text-ink-faint">{t('Venues de Telegram, du CLI ou des crons, en lecture seule')}</p>
        </div>
        {inst.profiles.length > 0 && (
          <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label={t('Agent')}
            className="h-8 rounded-lg border border-line bg-sheet px-2 font-mono text-xs focus:border-ink focus:outline-none">
            <option value="default">default</option>
            {inst.profiles.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      {q.isSuccess && rows.length === 0 && <p className="border-t border-line/70 px-4 py-3 text-sm text-ink-faint">{t('Aucune')}</p>}
      <ul>
        {rows.map((s) => (
          <li key={s.id} className="border-t border-line/70">
            <Link to="/i/$inst/p/$profile/s/$sessionId" params={{ inst: inst.id, profile, sessionId: s.id }}
              className="flex h-12 items-center gap-3.5 px-4 text-sm transition-colors hover:bg-paper">
              <span className="min-w-0 flex-1 truncate">{s.title || s.preview || <span className="font-mono text-xs text-ink-faint">{s.id}</span>}</span>
              <span className="shrink-0 text-xs text-ink-faint">{s.lastActive ?? s.startedAt ? timeAgo((s.lastActive ?? s.startedAt)! * 1000) : ''}</span>
              <Tag>{SOURCE[s.source ?? ''] ?? s.source ?? '?'}</Tag>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <div className="border-t border-line/70 px-2 py-2">
          <Button variant="ghost" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('Plus')}</Button>
        </div>
      )}
    </section>
  );
}
