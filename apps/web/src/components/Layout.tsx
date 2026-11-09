import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ModuleState } from '../api';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Accueil' },
  { to: '/etat', label: 'État' },
  { to: '/reglages', label: 'Réglages' },
] as const;

function worst(states: ModuleState[]): ModuleState {
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('readonly')) return 'readonly';
  return 'full';
}
const DOT: Record<ModuleState, string> = { full: 'bg-ok', readonly: 'bg-warn', unavailable: 'bg-bad' };

export function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 60_000 });

  const logout = async () => {
    await api.logout();
    qc.clear();
    await navigate({ to: '/connexion' });
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line md:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="text-[15px] font-semibold tracking-tight">Intendia</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-3 py-2">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === '/' }}
              className="rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-line/50 hover:text-ink"
              activeProps={{ className: 'bg-line/60 !text-ink font-medium' }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 px-6 text-xs font-medium text-ink-faint">Instances</div>
        <ul className="mt-1.5 space-y-0.5 px-3">
          {instances.data?.instances.map((i) => {
            const r = compat.data?.reports.find((x) => x.instanceId === i.id);
            const s = r ? worst(r.modules.map((m) => m.state)) : null;
            return (
              <li key={i.id}>
                <Link to="/etat" hash={i.id} className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-line/50 hover:text-ink">
                  <span className={cx('size-2 rounded-full', s ? DOT[s] : 'bg-line')} />
                  <span className="truncate">{i.label}</span>
                  {r?.hermesVersion && <span className="ml-auto font-mono text-[11px] text-ink-faint">{r.hermesVersion}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto border-t border-line p-3">
          <button onClick={logout} className="w-full rounded-md px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-line/50 hover:text-ink">
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 flex border-t border-line bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === '/' }}
            className="flex-1 py-3 text-center text-sm text-ink-soft"
            activeProps={{ className: '!text-accent font-medium' }}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-5 pt-6 md:px-8 md:pt-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
