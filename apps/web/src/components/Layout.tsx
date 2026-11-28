import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bot, Brain, CalendarClock, Columns3, Ellipsis, Files, Folder, House, KanbanSquare, Keyboard, KeyRound, Layers, LifeBuoy, LineChart, LogOut, MessageSquareText, MessagesSquare, PenLine, Search, Server, Settings2, SlidersHorizontal } from 'lucide-react';
import { useFailuresSeen } from '../crons/failuresSeen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { currentTab, navTarget, setTab, useCurrentInstance, useUrlInstance, type InstancePage } from '../instance/current';
import { Approvals } from './Approvals';
import { CommandPalette, shortcutLabel } from './CommandPalette';
import type { PaletteMode } from './palette';
import { InstanceRail, InstanceSwitcher } from './InstanceSwitcher';
import { EMBEDDED, isSideChatKey, toggleFromFrame } from '../chat/embed';
import { flushDrafts } from '../chat/draft';
import { useChat } from '../chat/columns';
import { SideChat } from './SideChat';
import { StatusBars } from './StatusBars';
import { useTabStatus } from './tabStatus';
import { isEditable, overlayOpen, shortcutOf } from './shortcuts';
import { ShortcutsSheet } from './ShortcutsSheet';
import { getActivePage } from './activePage';
import { DirtyBlocker, useAnyDirty } from './dirty';
import { cx, LogoMark } from './ui';
import { Popover } from './Menu';
import { plural, t } from '../i18n';

/** rail: the page rail (OpenBot-like); more and foot: in the « Plus » menu at its bottom (and the palette) */
type NavGroup = 'rail' | 'foot' | 'more';

interface NavEntry { key: string; to: string; label: string; icon: typeof House; group: NavGroup; page?: InstancePage; short?: string; words?: string }

/**
 * In display order; `group` places each entry; `page`: per instance; `short`: the rail's label under the icon;
 * `words`: older and technical names the palette also finds the page by (never shown).
 */
const NAV: readonly NavEntry[] = [
  { key: 'home', to: '/', label: t('Sessions'), icon: MessagesSquare, group: 'rail' },
  { key: 'kanban', to: '/kanban', label: t('Tâches'), icon: KanbanSquare, group: 'rail', page: 'kanban', words: 'kanban missions' },
  { key: 'crons', to: '/crons', label: t('Planning'), icon: CalendarClock, group: 'rail', page: 'crons', words: 'crons cron planifications schedules' },
  { key: 'files', to: '/files', label: t('Fichiers'), icon: Files, group: 'rail', page: 'files' },
  { key: 'monitor', to: '/suivi', label: t('Coûts et journaux'), icon: LineChart, group: 'rail', page: 'suivi', short: t('Coûts'), words: 'suivi usage monitor logs' },
  { key: 'activity', to: '/activite', label: t('Activité'), icon: Activity, group: 'rail', words: 'centre' },
  { key: 'chat', to: '/chat', label: t('Vue en colonnes'), icon: Columns3, group: 'more', words: 'chat' },
  { key: 'workspaces', to: '/w', label: t('Dossiers'), icon: Folder, group: 'more', words: 'workspaces' },
  { key: 'skills', to: '/skills', label: t('Skills'), icon: Layers, group: 'more', page: 'skills' },
  { key: 'memory', to: '/memoire', label: t('Mémoire'), icon: Brain, group: 'more', page: 'memoire' },
  { key: 'access', to: '/acces', label: t('Accès aux sites'), icon: KeyRound, group: 'more', page: 'acces', words: 'coffre vault' },
  { key: 'agents', to: '/agents', label: t('Agents'), icon: Bot, group: 'more', page: 'agents', words: 'profils profiles' },
  { key: 'config', to: '/config', label: t('Configuration'), icon: SlidersHorizontal, group: 'more', page: 'config', words: 'yaml modèles fournisseurs' },
  { key: 'status', to: '/etat', label: t('État'), icon: Server, group: 'foot', words: 'santé compat' },
  { key: 'settings', to: '/reglages', label: t('Réglages'), icon: Settings2, group: 'foot' },
  { key: 'help', to: '/aide', label: t('Aide'), icon: LifeBuoy, group: 'foot', words: 'help glossaire mots premiers pas' },
];

/** Which entry the address belongs to: sessions, folders and the chat all live in « Sessions ». */
export function activeKey(pathname: string): string | null {
  if (/^\/w\/[^/]+\/s\//.test(pathname) || pathname === '/chat' || pathname.startsWith('/chat/')) return 'home';
  if (pathname === '/' || pathname === '/sessions' || /^\/i\/[^/]+\/p\//.test(pathname)) return 'home';
  if (/^\/w(\/[^/]+(\/fichiers)?)?\/?$/.test(pathname)) return 'workspaces';
  if (pathname === '/files' || /^\/i\/[^/]+\/files(\/|$)/.test(pathname) || pathname === '/liens') return 'files';
  for (const n of NAV) {
    if (n.to === '/') continue;
    if (pathname === n.to || pathname.startsWith(`${n.to}/`) || new RegExp(`^/i/[^/]+${n.to}(/|$)`).test(pathname)) return n.key;
  }
  return null;
}

/** A page of the rail: icon over a short label. */
const RAIL_ITEM = 'flex w-full flex-col items-center gap-1 rounded-[12px] px-1 pb-1.5 pt-2 text-ink-soft transition-colors hover:bg-raised hover:text-ink';
/** Selected page: a white tile with a hairline ring (the ! classes win over the hover). */
const RAIL_ON = '!bg-sheet !text-ink font-medium shadow-[0_0_0_1px_var(--color-line)]';
/** A line of the « Plus » menu. */
const MORE_ITEM = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink hover:bg-raised focus:bg-raised focus:outline-none';

export function Layout() {
  return <>{EMBEDDED ? <EmbeddedLayout /> : <FullLayout />}<DirtyBlocker /></>;
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
  const { unseen } = useFailuresSeen();
  const failed = inst ? unseen(inst, myCrons) : 0;
  // every open chat of this tab, whatever its instance
  const openChats = useChat().open.length;
  const counts: Record<string, { n?: number; bad?: boolean; label?: string }> = {
    chat: { n: openChats || undefined, label: plural(openChats, '{n} chat ouvert', '{n} chats ouverts') },
    workspaces: { n: inst ? mine.length : undefined },
    crons: failed > 0
      ? { n: failed, bad: true, label: t('{n} en échec', { n: failed }) }
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
  const paletteNav = NAV.map((n) => ({ key: n.key, label: n.label, words: n.words, target: navTarget(n, inst) }));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = activeKey(pathname);
  useTabStatus(NAV.find((n) => n.key === current)?.label ?? null);

  // Ctrl/Cmd K anywhere (even in a field) toggles the palette; closing gives the focus back
  const [palette, setPalette] = useState<false | PaletteMode>(false);
  const before = useRef<HTMLElement | null>(null);
  const openPalette = useCallback((mode: PaletteMode = 'all') => {
    if (!before.current) before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPalette(mode);
  }, []);
  const closePalette = useCallback((o?: { restoreFocus?: boolean }) => {
    setPalette(false);
    const el = before.current;
    before.current = null;
    // an action of the palette opened a dialog or a menu: the focus stays there
    if (o?.restoreFocus !== false && el?.isConnected) requestAnimationFrame(() => el.focus());
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
  // « ? »: the keyboard shortcuts
  const [help, setHelp] = useState(false);
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
      } else {
        // one-key shortcuts: outside fields, no window, sheet or menu open
        const id = shortcutOf(e, { editable: isEditable(e.target), overlay: overlayOpen() });
        if (!id) return;
        e.preventDefault();
        if (id === 'help') setHelp(true);
        else if (id === 'new') void navigate({ to: '/chat/nouvelle' });
        else {
          const focus = getActivePage()?.focusComposer;
          if (focus) focus();
          else openPalette();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [palette, openPalette, closePalette, side, onSession, inst, openSide, closeSide, navigate]);

  const logout = async () => {
    await api.logout();
    qc.clear();
    await navigate({ to: '/connexion' });
  };

  const railEntry = (n: NavEntry) => {
    const on = current === n.key;
    const c = counts[n.key] ?? {};
    return (
      <Link
        key={n.key}
        {...(navTarget(n, inst) as { to: string })}
        activeOptions={{ exact: true }}
        activeProps={{}}
        title={c.label ? `${n.label} (${c.label})` : n.label}
        className={cx(RAIL_ITEM, on && RAIL_ON)}
        // same marks as a router-active link, so assistive tech and tests see the entry as current
        {...(on ? { 'aria-current': 'page' as const, 'data-status': 'active' } : { 'aria-current': undefined, 'data-status': undefined })}
      >
        <span className="relative">
          <n.icon className="size-[19px]" strokeWidth={1.5} />
          {/* the rail only counts what needs a look; plain totals stay in « Plus » and on the pages */}
          {c.n && c.bad ? <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-bad px-1 text-center font-mono text-[10px] leading-4 text-sheet" role="img" aria-label={`(${c.label ?? c.n})`}>{c.n}</span> : null}
        </span>
        <span className="max-w-full truncate text-[10.5px] leading-none">{n.short ?? n.label}</span>
      </Link>
    );
  };

  // the pages behind « Plus »: the button carries the mark of the current one
  const inMore = NAV.some((n) => n.group !== 'rail' && n.key === current);
  const moreLink = (n: NavEntry, close: () => void) => {
    const c = counts[n.key] ?? {};
    return (
      <Link key={n.key} {...(navTarget(n, inst) as { to: string })} role="menuitem" onClick={close}
        className={cx(MORE_ITEM, current === n.key && 'bg-raised font-medium')}
        {...(current === n.key ? { 'aria-current': 'page' as const } : {})}>
        <n.icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate">{n.label}</span>
        {c.n ? <span className="font-mono text-[11px] text-ink-faint" title={c.label}>{c.n}</span> : null}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-[76px] shrink-0 flex-col items-center gap-1 bg-paper pb-3 pt-3.5 md:flex" aria-label={t('Barre latérale')}>
        <Link to="/" title="Intendia" className="mb-1 rounded-[12px] focus-visible:outline-2"><LogoMark className="size-9" /></Link>
        <InstanceRail />
        <div className="my-1.5 h-px w-8 shrink-0 bg-line" />
        <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1.5" aria-label={t('Navigation principale')}>
          {NAV.filter((n) => n.group === 'rail').map(railEntry)}
        </nav>
        <div className="flex w-full flex-col items-center gap-0.5 px-1.5 pt-2">
          <Link to="/chat/nouvelle" preload={false} title={t('Nouvelle session')} aria-label={t('Nouvelle session')}
            className="mb-1 flex size-10 items-center justify-center rounded-[12px] border border-accent-strong bg-accent text-on-accent transition-colors hover:bg-accent-strong">
            <PenLine className="size-[18px]" strokeWidth={1.75} />
          </Link>
          <button type="button" onClick={() => openPalette()} aria-haspopup="dialog"
            title={t('Rechercher ({key}) ; un fichier : {fileKey}', { key: shortcutLabel(), fileKey: shortcutLabel().replace('K', 'P') })}
            className={RAIL_ITEM}>
            <Search className="size-[19px]" strokeWidth={1.5} />
            <span className="max-w-full truncate text-[10.5px] leading-none">{t('Rechercher')}</span>
          </button>
          <Popover
            title={t('Plus')} placement="above" align="start" width={248}
            triggerClass={cx(RAIL_ITEM, inMore && RAIL_ON)}
            trigger={<><Ellipsis className="size-[19px]" strokeWidth={1.5} /><span className="max-w-full truncate text-[10.5px] leading-none">{t('Plus')}</span></>}
          >
            {(close) => (
              <>
                {NAV.filter((n) => n.group === 'more').map((n) => moreLink(n, close))}
                <hr className="my-1 border-line" />
                {!onSession && inst && (
                  <button type="button" role="menuitem" className={MORE_ITEM} onClick={() => { close(); if (side) closeSide(); else openSide(); }}>
                    <MessageSquareText className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate">{t('Chat latéral')}</span>
                    <kbd className="font-mono text-[11px] text-ink-faint">{shortcutLabel().replace('K', 'J')}</kbd>
                  </button>
                )}
                {NAV.filter((n) => n.group === 'foot').map((n) => moreLink(n, close))}
                <button type="button" role="menuitem" aria-haspopup="dialog" className={MORE_ITEM} onClick={() => { close(); setHelp(true); }}>
                  <Keyboard className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate">{t('Raccourcis clavier')}</span>
                  <kbd className="font-mono text-[11px] text-ink-faint">?</kbd>
                </button>
                <hr className="my-1 border-line" />
                <button type="button" role="menuitem" className={MORE_ITEM} onClick={() => { close(); void logout(); }}>
                  <LogOut className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1 truncate">{t('Se déconnecter')}</span>
                </button>
                {version && <p className="px-2.5 pb-0.5 pt-1.5 font-mono text-[11px] text-ink-faint">Intendia v{version}</p>}
              </>
            )}
          </Popover>
        </div>
      </aside>

      <main data-scroll-root className="min-w-0 flex-1 overflow-y-auto bg-sheet pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:h-[var(--card-h)] md:pb-0">
        <div className="enter">
          <Outlet />
        </div>
      </main>

      <StatusBars />
      {side && inst && <SideChat key={inst} inst={inst} workspaces={mine} onClose={closeSide} />}
      {palette && <CommandPalette nav={paletteNav} onClose={closePalette} mode={palette} />}
      {help && <ShortcutsSheet onClose={() => setHelp(false)} />}
      <Approvals />
      <UnsavedMark />
      <MobileNav version={version} inst={inst} onLogout={logout} onSearch={() => openPalette()} onChat={!onSession && inst ? openSide : undefined} current={current} />
    </div>
  );
}

/** A discreet reminder while a form holds text that is not saved yet (the dirty registry of components/dirty). */
function UnsavedMark() {
  const dirty = useAnyDirty();
  if (!dirty) return null;
  return createPortal(
    <p role="status" data-unsaved className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-[60] flex items-center gap-2 rounded-full border border-line bg-sheet px-3 py-1.5 text-[13px] text-ink-soft shadow-[var(--shadow-card)] md:bottom-4 md:right-4">
      <span aria-hidden className="size-2 rounded-full bg-accent" />
      {t('Modifications non enregistrées')}
    </p>,
    document.body,
  );
}

/** Bottom bar on phones: the first entries, the others behind "Plus". */
const MOBILE_MAIN: string[] = ['home', 'activity', 'kanban', 'crons'];

function MobileNav({ current, onSearch, onChat, onLogout, version, inst }: { current: string | null; onSearch: () => void; onChat?: () => void; onLogout: () => void; version?: string; inst: string | null }) {
  const [more, setMore] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // biome-ignore lint/correctness/useExhaustiveDependencies(pathname): the trigger, not read by the effect: it runs again when this changes
  useEffect(() => setMore(false), [pathname]);
  const main = MOBILE_MAIN.map((key) => NAV.find((n) => n.key === key)!);
  const rest = NAV.filter((n) => !MOBILE_MAIN.includes(n.key));
  const item = 'flex h-15 flex-1 flex-col items-center justify-center gap-1 text-[11px]';
  return (
    <>
      {more && createPortal(
        // biome-ignore lint/a11y/noStaticElementInteractions: a tap on the backdrop closes the mobile "More" menu; it holds links that close it when followed
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: a tap on the backdrop closes the mobile "More" menu
        // biome-ignore lint/a11y/useKeyWithClickEvents: mobile-only backdrop; the keyboard closes the menu with the "More" button itself
        <div data-overlay className="fixed inset-0 z-40 bg-ink/20 md:hidden" onClick={() => setMore(false)}>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the click only stops the backdrop close; the nav itself is not a control */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click only stops the backdrop close; no action to reach by keyboard */}
          <nav aria-label={t('Plus')} onClick={(e) => e.stopPropagation()}
            className="enter absolute inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] grid grid-cols-3 gap-1 border-t border-line bg-sheet p-3">
            <InstanceSwitcher className="col-span-3" onPicked={() => setMore(false)} />
            <button type="button" onClick={() => { setMore(false); onSearch(); }}
              className="col-span-3 flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft">
              <Search className="size-4" strokeWidth={1.5} />
              {t('Rechercher')}
            </button>
            {onChat && (
              <button type="button" onClick={() => { setMore(false); onChat(); }}
                className="col-span-3 flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft">
                <MessageSquareText className="size-4" strokeWidth={1.5} />
                {t('Chat latéral')}
              </button>
            )}
            <NewSessionButton className="col-span-3 mb-2" onClick={() => setMore(false)} />
            {rest.map((n) => (
              <Link key={n.key} {...(navTarget(n, inst) as { to: string })} className={`${item} rounded-lg ${current === n.key ? 'bg-raised font-medium text-ink' : 'text-ink-soft'}`}>
                <n.icon className="size-5" strokeWidth={1.5} />
                {n.label}
              </Link>
            ))}
            <button type="button" onClick={() => { setMore(false); onLogout(); }} className={`${item} rounded-lg text-ink-soft`}>
              <LogOut className="size-5" strokeWidth={1.5} />
              {t('Se déconnecter')}
            </button>
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
          {t('Plus')}
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
      {t('Nouvelle session')}
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
