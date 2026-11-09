import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { House, ListChecks, LogOut, Settings2 } from 'lucide-react';
import { api } from '../api';
import { Mark, Wordmark, worst } from './ui';

const NAV = [
  { to: '/', label: 'Accueil', icon: House },
  { to: '/etat', label: 'État', icon: ListChecks },
  { to: '/reglages', label: 'Réglages', icon: Settings2 },
] as const;

const ROW = 'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink';

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
        <div className="flex h-16 items-center px-5">
          <Wordmark />
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === '/' }}
              className={ROW}
              activeProps={{ className: '!bg-raised !text-ink shadow-[inset_0_0_0_1px_var(--color-line)]' }}
            >
              <n.icon className="size-4 shrink-0" strokeWidth={1.5} />
              {n.label}
            </Link>
          ))}
        </nav>

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

        <div className="mt-auto border-t border-line px-3 py-3">
          <button onClick={logout} className={ROW + ' w-full'}>
            <LogOut className="size-4 shrink-0" strokeWidth={1.5} />
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
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
            className="flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] text-ink-faint"
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
