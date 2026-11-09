import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type PublicInstance } from '../api';
import { PageHeader } from '../components/Layout';
import { NewWorkspace } from '../components/NewWorkspace';
import { Button, Panel, timeAgo } from '../components/ui';

const SOURCE: Record<string, string> = { telegram: 'Telegram', cli: 'CLI', cron: 'Cron', api_server: 'API', discord: 'Discord', slack: 'Slack' };

function OtherSessions({ inst }: { inst: PublicInstance }) {
  const [profile, setProfile] = useState('default');
  const q = useInfiniteQuery({
    queryKey: ['other-sessions', inst.id, profile],
    queryFn: ({ pageParam }) => api.otherSessions(inst.id, profile, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.sessions) ?? [];
  return (
    <Panel
      bodyClassName=""
      title={<span>Autres sessions <span className="ml-2 text-xs font-normal text-ink-faint">{inst.label}</span></span>}
      action={inst.profiles.length > 0 && (
        <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Agent"
          className="h-8 rounded-lg border border-line bg-sheet px-2 text-xs focus:border-accent focus:outline-none">
          <option value="default">default</option>
          {inst.profiles.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}
    >
      <p className="px-5 pt-4 text-xs text-ink-faint">Sessions venues de Telegram, du CLI ou des crons, en lecture seule</p>
      {q.isSuccess && rows.length === 0 && <p className="px-5 py-4 text-sm text-ink-soft">Aucune</p>}
      <ul className="mt-2 divide-y divide-line">
        {rows.map((s) => (
          <li key={s.id}>
            <Link to="/i/$inst/p/$profile/s/$sessionId" params={{ inst: inst.id, profile, sessionId: s.id }}
              className="flex h-12 items-center gap-3 px-5 text-sm transition-colors hover:bg-raised/50">
              <span className="w-16 shrink-0 font-mono text-[11px] text-ink-faint">{SOURCE[s.source ?? ''] ?? s.source ?? '?'}</span>
              <span className="min-w-0 flex-1 truncate">{s.title || s.preview || <span className="font-mono text-xs text-ink-faint">{s.id}</span>}</span>
              <span className="shrink-0 text-xs text-ink-faint">{s.lastActive ?? s.startedAt ? timeAgo((s.lastActive ?? s.startedAt)! * 1000) : ''}</span>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <div className="border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>Plus</Button>
        </div>
      )}
    </Panel>
  );
}

export function WorkspacesPage() {
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const [adding, setAdding] = useState(false);
  const list = workspaces.data?.workspaces ?? [];
  const label = (id: string) => instances.data?.instances.find((i) => i.id === id)?.label ?? id;
  const empty = workspaces.isSuccess && list.length === 0;

  return (
    <>
      <PageHeader
        title="Workspaces"
        subtitle="Un workspace = un dossier partagé avec l’agent, ses consignes et ses sessions"
        action={!adding && !empty && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" strokeWidth={1.75} />Nouveau workspace</Button>}
      />
      <div className="space-y-6 px-5 pb-12 md:px-8">
        {(adding || empty) && (
          <Panel title="Nouveau workspace">
            <NewWorkspace onCancel={empty ? undefined : () => setAdding(false)} />
          </Panel>
        )}
        {list.length > 0 && (
          <Panel bodyClassName="">
            <ul className="divide-y divide-line">
              {list.map((w) => (
                <li key={w.slug}>
                  <Link to="/w/$slug" params={{ slug: w.slug }} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-raised/50">
                    <span className="text-sm font-medium">{w.name}</span>
                    <span className="font-mono text-xs text-ink-faint">{w.slug}</span>
                    <span className="ml-auto text-xs text-ink-soft">{label(w.instanceId)} · {w.profile ?? 'default'}{w.model ? ` · ${w.model}` : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {instances.data?.instances.map((i) => <OtherSessions key={i.id} inst={i} />)}
      </div>
    </>
  );
}
