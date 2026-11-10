import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FolderOpen, House, Link2, ListChecks, LogOut, Plus, Settings2 } from 'lucide-react';
import { api } from '../api';
import { Mark, Wordmark, worst } from './ui';

const NAV = [
  { to: '/', label: 'Accueil', icon: House },
  { to: '/w', label: 'Workspaces', icon: FolderOpen },
  { to: '/liens', label: 'Liens', icon: Link2 },
  { to: '/crons', label: 'Crons', icon: CalendarClock },
  { to: '/etat', label: 'État', icon: ListChecks },
  { to: '/reglages', label: 'Réglages', icon: Settings2 },
] as const;

const ROW = 'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink';

export function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 60_000 });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const params = useParams({ strict: false }) as { slug?: string; sessionId?: string };
  const openSlug = params.slug;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  /** /crons redirects to /i/<instance>/crons: keep its entry active there */
  const alsoActive = (to: string) => to === '/crons' && /^\/i\/[^/]+\/crons$/.test(pathname);
  const sessions = useQuery({ queryKey: ['sessions', openSlug, false], queryFn: () => api.sessions(openSlug!), enabled: Boolean(openSlug) });

  const logout = async () => {
    await api.logout();
    qc.clear();
    await navigate({ to: '/connexion' });
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line md:flex">
        <div className="flex h-16 items-center px-5">
          <Wordmark />
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === '/' || n.to === '/w' }}
              className={ROW + (alsoActive(n.to) ? ' !bg-raised !text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' : '')}
              activeProps={{ className: '!bg-raised !text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' }}
            >
              <n.icon className="size-4 shrink-0" strokeWidth={1.5} />
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {(workspaces.data?.workspaces.length ?? 0) > 0 && (
          <>
            <div className="mt-6 px-5 pb-2 text-xs text-ink-faint">Workspaces</div>
            <ul className="flex flex-col gap-0.5 px-3">
              {workspaces.data!.workspaces.map((w) => (
                <li key={w.slug}>
                  <Link
                    to="/w/$slug"
                    params={{ slug: w.slug }}
                    activeOptions={{ exact: true }}
                    className={ROW}
                    activeProps={{ className: '!bg-raised !text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' }}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center font-mono text-[11px] text-ink-faint">#</span>
                    <span className="truncate">{w.name}</span>
                  </Link>
                  {openSlug === w.slug && (
                    <ul className="ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
                      {sessions.data?.sessions.slice(0, 8).map((s) => (
                        <li key={s.id}>
                          <Link
                            to="/w/$slug/s/$sessionId"
                            params={{ slug: w.slug, sessionId: s.id }}
                            className="flex h-7 items-center rounded-md px-2 text-[13px] text-ink-soft transition-colors hover:bg-raised hover:text-ink"
                            activeProps={{ className: '!bg-raised !text-ink' }}
                          >
                            <span className="truncate">{s.title || 'Nouvelle session'}</span>
                          </Link>
                        </li>
                      ))}
                      <li>
                        <NewSessionLink slug={w.slug} />
                      </li>
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-6 px-5 pb-2 text-xs text-ink-faint">Instances</div>
        <ul className="flex flex-col gap-0.5 px-3">
          {instances.data?.instances.map((i) => {
            const r = compat.data?.reports.find((x) => x.instanceId === i.id);
            return (
              <li key={i.id}>
                <Link to="/etat" hash={i.id} className={ROW}>
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <Mark state={r ? worst(r.modules.map((m) => m.state)) : null} />
                  </span>
                  <span className="truncate">{i.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        </div>

        <div className="border-t border-line px-3 py-3">
          <button onClick={logout} className={ROW + ' w-full'}>
            <LogOut className="size-4 shrink-0" strokeWidth={1.5} />
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="enter mx-auto max-w-[1440px]">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 flex border-t border-line bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === '/' }}
            className={`flex h-15 flex-1 flex-col items-center justify-center gap-1 text-[11px] ${alsoActive(n.to) ? 'text-accent' : 'text-ink-faint'}`}
            activeProps={{ className: '!text-accent' }}
          >
            <n.icon className="size-5" strokeWidth={1.5} />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function NewSessionLink({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = async () => {
    const { session } = await api.createSession(slug);
    await qc.invalidateQueries({ queryKey: ['sessions'] });
    await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
  };
  return (
    <button onClick={() => void create()} className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-faint transition-colors hover:bg-raised hover:text-ink">
      <Plus className="size-3.5" strokeWidth={1.5} />
      Nouvelle session
    </button>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-6 pt-8 md:px-8 md:pt-10">
      <div>
        <h1 className="text-[28px] font-medium leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
