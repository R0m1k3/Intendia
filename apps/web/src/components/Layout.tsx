import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bot, Brain, CalendarClock, Ellipsis, Files, Folder, House, Inbox, KanbanSquare, Layers, LineChart, LogOut, MessageSquareText, MessagesSquare, PenLine, Search, Server, Settings2, SlidersHorizontal } from 'lucide-react';
import { failedCount } from '../home/summary';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { currentTab, navTarget, setTab, useCurrentInstance, useUrlInstance, type InstancePage } from '../instance/current';
import { Approvals } from './Approvals';
import { CommandPalette, shortcutLabel } from './CommandPalette';
import type { PaletteMode } from './palette';
import { InstanceSwitcher } from './InstanceSwitcher';
import { EMBEDDED, isSideChatKey, toggleFromFrame } from '../chat/embed';
import { flushDrafts } from '../chat/draft';
import { useChat } from '../chat/columns';
import { SideChat } from './SideChat';
import { cx, Wordmark } from './ui';

type NavGroup = 'top' | 'auto' | 'agent' | 'foot';

interface NavEntry { key: string; to: string; label: string; icon: typeof House; group: NavGroup; page?: InstancePage }

/** In display order; `group` places each entry in the sidebar; `page`: per instance. */
const NAV: readonly NavEntry[] = [
  { key: 'home', to: '/', label: 'Sessions', icon: Inbox, group: 'top' },
  { key: 'chat', to: '/chat', label: 'Chat', icon: MessagesSquare, group: 'top' },
  { key: 'workspaces', to: '/w', label: 'Workspaces', icon: Folder, group: 'top' },
  { key: 'files', to: '/files', label: 'Fichiers', icon: Files, group: 'top', page: 'files' },
  { key: 'crons', to: '/crons', label: 'Crons', icon: CalendarClock, group: 'auto', page: 'crons' },
  { key: 'kanban', to: '/kanban', label: 'Kanban', icon: KanbanSquare, group: 'auto', page: 'kanban' },
  { key: 'skills', to: '/skills', label: 'Skills', icon: Layers, group: 'agent', page: 'skills' },
  { key: 'memory', to: '/memoire', label: 'Mémoire', icon: Brain, group: 'agent', page: 'memoire' },
  { key: 'agents', to: '/agents', label: 'Agents', icon: Bot, group: 'agent', page: 'agents' },
  { key: 'config', to: '/config', label: 'Configuration', icon: SlidersHorizontal, group: 'agent', page: 'config' },
  { key: 'monitor', to: '/suivi', label: 'Suivi', icon: LineChart, group: 'foot', page: 'suivi' },
  { key: 'activity', to: '/activite', label: 'Activité', icon: Activity, group: 'foot' },
  { key: 'status', to: '/etat', label: 'État', icon: Server, group: 'foot' },
  { key: 'settings', to: '/reglages', label: 'Réglages', icon: Settings2, group: 'foot' },
];

/** Which entry the address belongs to: sessions open in the inbox light "Sessions", a workspace "Workspaces". */
export function activeKey(pathname: string): string | null {
  if (/^\/w\/[^/]+\/s\//.test(pathname)) return 'chat';
  if (pathname === '/' || pathname === '/sessions' || /^\/i\/[^/]+\/p\//.test(pathname)) return 'home';
  if (/^\/w(\/[^/]+(\/fichiers)?)?\/?$/.test(pathname)) return 'workspaces';
  if (pathname === '/files' || /^\/i\/[^/]+\/files(\/|$)/.test(pathname) || pathname === '/liens') return 'files';
  for (const n of NAV) {
    if (n.to === '/') continue;
    if (pathname === n.to || pathname.startsWith(`${n.to}/`) || new RegExp(`^/i/[^/]+${n.to}(/|$)`).test(pathname)) return n.key;
  }
  return null;
}

const ROW = 'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink';
/** Selected entry: a white tab with a hairline ring (the ! classes win over ROW's hover). */
const ACTIVE = '!bg-sheet !text-ink font-medium shadow-[0_0_0_1px_var(--color-line)]';

const GROUP = 'px-2.5 pb-1 pt-4 text-xs text-ink-faint';

export function Layout() {
  return EMBEDDED ? <EmbeddedLayout /> : <FullLayout />;
}

/** Inside the side chat's iframe: the page alone; ⌘J goes to the page around it. */
function EmbeddedLayout() {
  // the page saves this frame's draft before removing it (SideChat)
  useEffect(() => { window.intendiaFlushDrafts = flushDrafts; }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSideChatKey(e)) return;
      e.preventDefault();
      toggleFromFrame();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <main data-scroll-root className="h-dvh overflow-y-auto bg-sheet">
      <Outlet />
    </main>
  );
}

/** A session open full size (Intendia's or an external one): the side chat has nothing to add there. */
const SESSION_PAGE = /\/s\/[^/]+\/?$/;

function FullLayout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { id: inst, instances } = useCurrentInstance();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const version = useQuery({ queryKey: ['setup'], queryFn: api.setup, staleTime: Infinity }).data?.version;
  const overview = useQuery({ queryKey: ['crons-overview'], queryFn: () => api.cronsOverview(), refetchInterval: 60_000 });
  const mine = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === inst);
  const myCrons = (overview.data?.crons ?? []).filter((c) => c.instanceId === inst);
  const failed = failedCount(myCrons);
  const openChats = useChat(inst).open.length;
  const counts: Record<string, { n?: number; bad?: boolean; label?: string }> = {
    chat: { n: openChats || undefined, label: `${openChats} chat${openChats > 1 ? 's' : ''} ouvert${openChats > 1 ? 's' : ''}` },
    workspaces: { n: inst ? mine.length : undefined },
    crons: failed > 0
      ? { n: failed, bad: true, label: `${failed} en échec` }
      : { n: inst && overview.data ? myCrons.length : undefined },
  };
  // the address names an instance (/i/<inst>/…, a workspace, /etat#<inst>): it becomes this tab's
  const { fromUrl } = useUrlInstance();
  const ids = instances.map((i) => i.id).join(',');
  useEffect(() => {
    if (fromUrl && ids.split(',').includes(fromUrl)) setTab(fromUrl);
  }, [fromUrl, ids]);
  // nothing chosen yet in this browser: the instance shown (the first) becomes this tab's, so a reload keeps it
  useEffect(() => {
    if (inst && currentTab() === null) setTab(inst);
  }, [inst]);
  const paletteNav = NAV.map((n) => ({ key: n.key, label: n.label, target: navTarget(n, inst) }));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = activeKey(pathname);

  // Ctrl/Cmd K anywhere (even in a field) toggles the palette; closing gives the focus back
  const [palette, setPalette] = useState<false | PaletteMode>(false);
  const before = useRef<HTMLElement | null>(null);
  const openPalette = useCallback((mode: PaletteMode = 'all') => {
    if (!before.current) before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPalette(mode);
  }, []);
  const closePalette = useCallback(() => {
    setPalette(false);
    const el = before.current;
    before.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, []);
  // Ctrl/Cmd J: the side chat, except on a session's own page (one draft written at a time)
  const onSession = SESSION_PAGE.test(pathname);
  const [side, setSide] = useState(false);
  const beforeSide = useRef<HTMLElement | null>(null);
  const openSide = useCallback(() => {
    beforeSide.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSide(true);
  }, []);
  const closeSide = useCallback(() => {
    setSide(false);
    const el = beforeSide.current;
    beforeSide.current = null;
    window.focus();
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, []);
  useEffect(() => { if (onSession) setSide(false); }, [onSession]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (palette) closePalette();
        else openPalette();
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        // Ctrl/⌘ P: a file of the instance (the browser's print stays in its menu)
        e.preventDefault();
        if (palette === 'files') closePalette();
        else openPalette('files');
      } else if (isSideChatKey(e)) {
        e.preventDefault();
        if (side) closeSide();
        else if (!onSession && inst) openSide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, openPalette, closePalette, side, onSession, inst, openSide, closeSide]);

  const logout = async () => {
    await api.logout();
    qc.clear();
    await navigate({ to: '/connexion' });
  };

  const entries = (group: NavGroup) => NAV.filter((n) => n.group === group).map((n) => {
    const on = current === n.key;
    return (
      <Link
        key={n.key}
        {...(navTarget(n, inst) as { to: string })}
        activeOptions={{ exact: true }}
        activeProps={{}}
        className={cx(ROW, on && ACTIVE)}
        // same marks as a router-active link, so assistive tech and tests see the entry as current
        {...(on ? { 'aria-current': 'page' as const, 'data-status': 'active' } : { 'aria-current': undefined, 'data-status': undefined })}
      >
        <n.icon className="size-4 shrink-0" strokeWidth={1.5} />
        <span className="flex-1 truncate">{n.label}</span>
        <Count {...(counts[n.key] ?? {})} />
      </Link>
    );
  });

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-[232px] shrink-0 flex-col bg-paper px-2.5 pb-3 pt-3.5 md:flex">
        <div className="flex items-center justify-between pb-3.5 pl-2.5 pt-0.5">
          <Wordmark />
          {!onSession && inst && (
            <button type="button" onClick={side ? closeSide : openSide} aria-expanded={side}
              aria-label="Chat latéral" title={`Chat latéral (${shortcutLabel().replace('K', 'J')})`}
              className={cx('flex size-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink', side && 'bg-raised text-ink')}>
              <MessageSquareText className="size-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
        <NewSessionButton />
        <InstanceSwitcher className="mt-2.5" />
        <button type="button" onClick={() => openPalette()} aria-haspopup="dialog" title={`Rechercher (${shortcutLabel()}) ; un fichier : ${shortcutLabel().replace('K', 'P')}`}
          className="mt-1.5 flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised hover:text-ink">
          <Search className="size-4 shrink-0" strokeWidth={1.5} />
          <span className="flex-1 text-left">Rechercher</span>
          <kbd className="font-mono text-[11px] text-ink-faint">{shortcutLabel()}</kbd>
        </button>

        <nav className="-mx-1 mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-4" aria-label="Navigation principale">
          {entries('top')}
          <p className={GROUP}>Automatisation</p>
          {entries('auto')}
          <p className={GROUP}>Agent</p>
          {entries('agent')}
        </nav>

        <div className="flex flex-col gap-0.5 pt-3">
          {entries('foot')}
          <div className="mt-2 flex items-center gap-2.5 border-t border-line px-2.5 pt-2.5">
            <button onClick={logout} className="flex min-w-0 flex-1 items-center gap-2.5 whitespace-nowrap rounded-lg text-sm text-ink-soft transition-colors hover:text-ink">
              <LogOut className="size-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Se déconnecter</span>
            </button>
            {version && <span className="shrink-0 font-mono text-[11px] text-ink-faint" title="Version d’Intendia">v{version}</span>}
          </div>
        </div>
      </aside>

      <main data-scroll-root className="min-w-0 flex-1 overflow-y-auto bg-sheet pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:h-[var(--card-h)] md:pb-0">
        <div className="enter">
          <Outlet />
        </div>
      </main>

      {side && inst && <SideChat key={inst} inst={inst} workspaces={mine} onClose={closeSide} />}
      {palette && <CommandPalette nav={paletteNav} onClose={closePalette} mode={palette} />}
      <Approvals />
      <MobileNav version={version} inst={inst} onSearch={() => openPalette()} onChat={!onSession && inst ? openSide : undefined} current={current} />
    </div>
  );
}

/** Small counter at the end of a sidebar entry; hidden for 0; red for failures. */
function Count({ n, bad, label }: { n?: number; bad?: boolean; label?: string }) {
  if (!n) return null;
  return <span className={cx('shrink-0 text-xs', bad ? 'font-semibold text-bad' : 'text-ink-faint')} aria-label={`(${label ?? n})`} title={label}>{n}</span>;
}

/** Bottom bar on phones: the first entries, the others behind "Plus". */
const MOBILE_MAIN: string[] = ['home', 'workspaces', 'activity', 'agents'];

function MobileNav({ current, onSearch, onChat, version, inst }: { current: string | null; onSearch: () => void; onChat?: () => void; version?: string; inst: string | null }) {
  const [more, setMore] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setMore(false), [pathname]);
  const main = MOBILE_MAIN.map((key) => NAV.find((n) => n.key === key)!);
  const rest = NAV.filter((n) => !MOBILE_MAIN.includes(n.key));
  const item = 'flex h-15 flex-1 flex-col items-center justify-center gap-1 text-[11px]';
  return (
    <>
      {more && createPortal(
        <div className="fixed inset-0 z-40 bg-ink/20 md:hidden" onClick={() => setMore(false)}>
          <nav aria-label="Plus" onClick={(e) => e.stopPropagation()}
            className="enter absolute inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] grid grid-cols-3 gap-1 border-t border-line bg-sheet p-3">
            <InstanceSwitcher className="col-span-3" onPicked={() => setMore(false)} />
            <button type="button" onClick={() => { setMore(false); onSearch(); }}
              className="col-span-3 flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft">
              <Search className="size-4" strokeWidth={1.5} />
              Rechercher
            </button>
            {onChat && (
              <button type="button" onClick={() => { setMore(false); onChat(); }}
                className="col-span-3 flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft">
                <MessageSquareText className="size-4" strokeWidth={1.5} />
                Chat latéral
              </button>
            )}
            <NewSessionButton className="col-span-3 mb-2" onClick={() => setMore(false)} />
            {rest.map((n) => (
              <Link key={n.key} {...(navTarget(n, inst) as { to: string })} className={`${item} rounded-lg ${current === n.key ? 'bg-raised font-medium text-ink' : 'text-ink-soft'}`}>
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
          <Link key={n.key} {...(navTarget(n, inst) as { to: string })} className={`${item} ${current === n.key ? 'font-medium text-ink' : 'text-ink-faint'}`}>
            <n.icon className="size-5" strokeWidth={1.5} />
            {n.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
          className={`${item} ${more || rest.some((n) => current === n.key) ? 'font-medium text-ink' : 'text-ink-faint'}`}>
          <Ellipsis className="size-5" strokeWidth={1.5} />
          Plus
        </button>
      </nav>
    </>
  );
}

/** "Nouvelle session": an empty session in a new chat column, cursor in its message box (route /chat/nouvelle). */
function NewSessionButton({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <Link
      // never preloaded: opening the route creates a session
      to="/chat/nouvelle" preload={false} onClick={onClick}
      className={cx('flex h-[34px] items-center justify-center gap-2 rounded-lg border border-accent-strong bg-accent px-3 text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-strong', className)}
    >
      <PenLine className="size-4" strokeWidth={1.5} />
      Nouvelle session
    </Link>
  );
}

export function PageHeader({ title, subtitle, action, eyebrow }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pb-5 pt-6 md:px-8 md:pt-7">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[13px] text-ink-faint">{eyebrow}</p>}
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-faint">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Reading width of the form pages (Configuration, Réglages) and of the home page. */
export function Narrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={['w-full max-w-[1000px]', className].filter(Boolean).join(' ')}>{children}</div>;
}
