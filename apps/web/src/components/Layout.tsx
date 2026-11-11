import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bot, CalendarClock, Ellipsis, Folder, FolderOpen, House, KanbanSquare, Link2, ListChecks, LogOut, MessagesSquare, Plus, Puzzle, Search, Settings2, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { CommandPalette, shortcutLabel } from './CommandPalette';
import { cx, Mark, Wordmark, worst } from './ui';

type NavGroup = 'top' | 'auto' | 'system' | 'hidden';

/** In display order; `group` places each entry in the sidebar (`hidden`: bottom bar only). */
const NAV = [
  { to: '/', label: 'Accueil', icon: House, group: 'top' },
  { to: '/sessions', label: 'Sessions', icon: MessagesSquare, group: 'top' },
  { to: '/kanban', label: 'Kanban', icon: KanbanSquare, group: 'top' },
  { to: '/crons', label: 'Crons', icon: CalendarClock, group: 'auto' },
  { to: '/skills', label: 'Skills', icon: Puzzle, group: 'auto' },
  { to: '/agents', label: 'Agents', icon: Bot, group: 'auto' },
  { to: '/w', label: 'Workspaces', icon: FolderOpen, group: 'hidden' },
  { to: '/activite', label: 'Activité', icon: Activity, group: 'system' },
  { to: '/config', label: 'Configuration', icon: SlidersHorizontal, group: 'system' },
  { to: '/liens', label: 'Liens', icon: Link2, group: 'system' },
  { to: '/etat', label: 'État', icon: ListChecks, group: 'system' },
  { to: '/reglages', label: 'Réglages', icon: Settings2, group: 'system' },
] as const satisfies readonly { to: string; label: string; icon: unknown; group: NavGroup }[];

const ROW = 'flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink';
/** Selected entry: a white tab lifted off the grey frame (the ! classes win over ROW's hover). */
const ACTIVE = '!bg-sheet !text-ink font-medium shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(22_24_27/0.05)]';
/** Entries offered by the search palette (every page but the bottom-bar-only ones). */
const PALETTE_NAV = NAV.filter((n) => n.group !== 'hidden');

const GROUP = 'flex items-center justify-between px-3 pb-2 pt-6 text-xs font-medium text-ink-faint';

export function Layout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 60_000 });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const version = useQuery({ queryKey: ['setup'], queryFn: api.setup, staleTime: Infinity }).data?.version;
  const overview = useQuery({ queryKey: ['crons-overview'], queryFn: api.cronsOverview, refetchInterval: 60_000 });
  const counts: Record<string, number | undefined> = { '/crons': overview.data?.crons.length };
  const params = useParams({ strict: false }) as { slug?: string; sessionId?: string };
  const openSlug = params.slug;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // per-instance console pages (/i/<inst>/crons, /i/<inst>/skills) light up their entry (/crons, /skills)
  const alsoActive = (to: string) => to !== '/' && new RegExp(`^/i/[^/]+${to}(/|$)`).test(pathname);
  const sessions = useQuery({ queryKey: ['sessions', openSlug, false], queryFn: () => api.sessions(openSlug!), enabled: Boolean(openSlug) });

  // Ctrl/Cmd K anywhere (even in a field) toggles the palette; closing gives the focus back
  const [palette, setPalette] = useState(false);
  const before = useRef<HTMLElement | null>(null);
  const openPalette = useCallback(() => {
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPalette(true);
  }, []);
  const closePalette = useCallback(() => {
    setPalette(false);
    const el = before.current;
    before.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (palette) closePalette();
        else openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, openPalette, closePalette]);

  const logout = async () => {
    await api.logout();
    qc.clear();
    await navigate({ to: '/connexion' });
  };

  const entries = (group: NavGroup) => NAV.filter((n) => n.group === group).map((n) => (
    <Link
      key={n.to}
      to={n.to}
      activeOptions={{ exact: n.to === '/' }}
      className={cx(ROW, alsoActive(n.to) && ACTIVE)}
      activeProps={{ className: ACTIVE }}
      // same marks as a router-active link, so assistive tech and tests see the entry as current
      {...(alsoActive(n.to) ? { 'aria-current': 'page' as const, 'data-status': 'active' } : {})}
    >
      <n.icon className="size-4 shrink-0" strokeWidth={1.5} />
      <span className="flex-1 truncate">{n.label}</span>
      <Count n={counts[n.to]} />
    </Link>
  ));

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-62 shrink-0 flex-col px-3 pb-3 pt-4 md:flex">
        <div className="px-2 pb-4 pt-1">
          <Wordmark />
        </div>
        <button type="button" onClick={openPalette} aria-haspopup="dialog"
          className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-line bg-sheet px-3 text-sm text-ink-soft transition-colors hover:text-ink">
          <Search className="size-4 shrink-0" strokeWidth={1.5} />
          <span className="flex-1 text-left">Rechercher</span>
          <kbd className="font-mono text-[11px] text-ink-faint">{shortcutLabel()}</kbd>
        </button>
        <NewSessionButton className="mb-4" />

        <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-4" aria-label="Navigation principale">
          {entries('top')}

          <p className={GROUP}>Automatisation</p>
          {entries('auto')}

          <p className={GROUP}>
            Workspaces
            <Link to="/w" aria-label="Nouveau workspace" title="Nouveau workspace"
              className="-my-1 flex size-[22px] items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-raised hover:text-ink">
              <Plus className="size-3.5" strokeWidth={1.5} />
            </Link>
          </p>
          {workspaces.data?.workspaces.map((w) => (
            <div key={w.slug} className="flex flex-col gap-0.5">
              <Link
                to="/w/$slug"
                params={{ slug: w.slug }}
                activeOptions={{ exact: true }}
                className={ROW}
                activeProps={{ className: ACTIVE }}
              >
                <Folder className="size-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate">{w.name}</span>
                <Count n={w.sessionCount} />
              </Link>
              {openSlug === w.slug && (
                <ul className="ml-7 flex flex-col gap-0.5">
                  {sessions.data?.sessions.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <Link
                        to="/w/$slug/s/$sessionId"
                        params={{ slug: w.slug, sessionId: s.id }}
                        className="flex h-7 items-center rounded-md px-2 text-[13px] text-ink-soft transition-colors hover:bg-raised hover:text-ink"
                        activeProps={{ className: ACTIVE }}
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
            </div>
          ))}

          <p className={GROUP}>Système</p>
          {entries('system')}
        </nav>

        <div className="flex flex-col gap-0.5 border-t border-line pt-3">
          {instances.data?.instances.map((i) => {
            const r = compat.data?.reports.find((x) => x.instanceId === i.id);
            return (
              <Link key={i.id} to="/etat" hash={i.id} className={ROW}>
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Mark state={r ? worst(r.modules.map((m) => m.state)) : null} />
                </span>
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                {r?.hermesVersion && <span className="shrink-0 font-mono text-xs text-ink-faint">v{r.hermesVersion.replace(/^v/, '')}</span>}
              </Link>
            );
          })}
          <button onClick={logout} className={ROW + ' w-full'}>
            <LogOut className="size-4 shrink-0" strokeWidth={1.5} />
            Se déconnecter
          </button>
          {version && <p className="px-3 pt-1 font-mono text-[11px] text-ink-faint" title="Version d’Intendia">Intendia v{version}</p>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-sheet pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:m-2 md:h-[var(--card-h)] md:rounded-[14px] md:border md:border-line md:pb-0 md:shadow-[var(--shadow-card)]">
        <div className="enter mx-auto max-w-[1440px]">
          <Outlet />
        </div>
      </main>

      {palette && <CommandPalette nav={PALETTE_NAV} onClose={closePalette} />}
      <MobileNav version={version} onSearch={openPalette} isActive={(to) => alsoActive(to) || pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))} />
    </div>
  );
}

/** Small counter at the end of a sidebar entry; hidden for 0. */
function Count({ n }: { n: number | undefined }) {
  if (!n) return null;
  return <span className="shrink-0 font-mono text-[11px] text-ink-faint" aria-label={`(${n})`}>{n}</span>;
}

/** Bottom bar on phones: the first entries, the others behind "Plus". */
const MOBILE_MAIN: string[] = ['/', '/w', '/activite', '/agents'];

function MobileNav({ isActive, onSearch, version }: { isActive: (to: string) => boolean; onSearch: () => void; version?: string }) {
  const [more, setMore] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setMore(false), [pathname]);
  const main = MOBILE_MAIN.map((to) => NAV.find((n) => n.to === to)!);
  const rest = NAV.filter((n) => !MOBILE_MAIN.includes(n.to));
  const item = 'flex h-15 flex-1 flex-col items-center justify-center gap-1 text-[11px]';
  return (
    <>
      {more && createPortal(
        <div className="fixed inset-0 z-40 bg-ink/20 md:hidden" onClick={() => setMore(false)}>
          <nav aria-label="Plus" onClick={(e) => e.stopPropagation()}
            className="enter absolute inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] grid grid-cols-3 gap-1 border-t border-line bg-sheet p-3">
            <button type="button" onClick={() => { setMore(false); onSearch(); }}
              className="col-span-3 flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft">
              <Search className="size-4" strokeWidth={1.5} />
              Rechercher
            </button>
            <NewSessionButton className="col-span-3 mb-2" onClick={() => setMore(false)} />
            {rest.map((n) => (
              <Link key={n.to} to={n.to} className={`${item} rounded-lg ${isActive(n.to) ? 'bg-raised text-accent' : 'text-ink-soft'}`}>
                <n.icon className="size-5" strokeWidth={1.5} />
                {n.label}
              </Link>
            ))}
            {version && <p className="col-span-3 pt-2 text-center font-mono text-[11px] text-ink-faint">Intendia v{version}</p>}
          </nav>
        </div>,
        document.body,
      )}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-line bg-sheet pb-[env(safe-area-inset-bottom)] md:hidden">
        {main.map((n) => (
          <Link key={n.to} to={n.to} className={`${item} ${isActive(n.to) ? 'text-accent' : 'text-ink-faint'}`}>
            <n.icon className="size-5" strokeWidth={1.5} />
            {n.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className={`${item} ${more || rest.some((n) => isActive(n.to)) ? 'text-accent' : 'text-ink-faint'}`}>
          <Ellipsis className="size-5" strokeWidth={1.5} />
          Plus
        </button>
      </nav>
    </>
  );
}

/** "Nouvelle session": the home page, cursor in "Demander quelque chose à Hermes…". */
function NewSessionButton({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link
      to="/" search={{ nouvelle: 1 }} onClick={onClick}
      className={cx('flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong', className)}
    >
      <Plus className="size-4" strokeWidth={1.75} />
      Nouvelle session
    </Link>
  );
}

function NewSessionLink({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = async () => {
    const { session } = await api.createSession(slug);
    await qc.invalidateQueries({ queryKey: ['sessions'] });
    void qc.invalidateQueries({ queryKey: ['workspaces'] });
    await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
  };
  return (
    <button onClick={() => void create()} className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-faint transition-colors hover:bg-raised hover:text-ink">
      <Plus className="size-3.5" strokeWidth={1.5} />
      Nouvelle session
    </button>
  );
}

export function PageHeader({ title, subtitle, action, eyebrow }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-6 pt-8 md:px-8 md:pt-10">
      <div>
        {eyebrow && <p className="mb-1.5 text-[13px] text-ink-faint">{eyebrow}</p>}
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Reading width of the form pages (Configuration, Réglages) and of the home page. */
export function Narrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={['mx-auto w-full max-w-[960px]', className].filter(Boolean).join(' ')}>{children}</div>;
}
