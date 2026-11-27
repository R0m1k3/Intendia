import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute, createRoute, createRouter, Outlet, redirect, RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getLang } from './i18n';
import { api, isTransient, SESSION_SOURCES, type SessionSource } from './api';
import { initConnection } from './connection/connection';
import { currentTab, resolveCurrent, type InstancePage } from './instance/current';
import { DialogHost } from './components/Dialog';
import { toast, toastError, Toasts } from './components/Toast';
import { Boundary, RouteError } from './components/ErrorScreen';
import { pruneDrafts } from './chat/draft';
import { UndoHost } from './sessions/UndoBar';
import { syncSessions } from './sessions/sync';
import { Layout } from './components/Layout';
import { ACCESS_KINDS, CONFIG_TABS, LOG_FILES, MEMORY_TABS, MONITOR_TABS, PERIODS, type ConfigTab, type MemoryTab, type MonitorTab, type Period } from './routes/search';
import { page, PagePending } from './routes/lazy';
import { HomePage } from './pages/Home';
import type { StepSearch } from './setup/Frame';
import type { KanbanSearch } from './pages/Kanban';
import type { SkillsSearch } from './pages/Skills';
import type { ConfigSearch } from './pages/Config';
import type { MemorySearch } from './pages/Memory';
import type { AccessSearch } from './pages/Access';
import type { MonitorSearch } from './pages/Monitor';
import type { FilesSearch } from './pages/Files';
import type { GitSearch } from './pages/Git';
import type { InstanceFilesSearch } from './pages/InstanceFiles';
import { loadChat, openBeside, updateChat } from './chat/columns';
import { pickWorkspace } from './chat/newSession';
import { invalidateSessionLists } from './sessions/UndoBar';
import { InboxLayout } from './sessions/InboxLayout';
import { parseCronKey } from './components/selection';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/spline-sans-mono';
import './styles.css';

const savedTheme = localStorage.getItem('intendia-theme');
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.classList.add(savedTheme);
document.documentElement.lang = getLang();

declare module '@tanstack/react-query' {
  interface Register { mutationMeta: { done?: string; fail?: boolean } }
}

const queryClient = new QueryClient({
  // a mutation asks for its toast with `meta`: { done: 'Enregistré' } on success, { fail: true } when it has no
  // place of its own to show the error
  mutationCache: new MutationCache({
    onSuccess: (_data, _vars, _ctx, m) => { if (typeof m.meta?.done === 'string') toast(m.meta.done); },
    onError: (err, _vars, _ctx, m) => { if (m.meta?.fail === true) toastError(err); },
  }),
  defaultOptions: {
    queries: {
      // only passing failures (Intendia unreachable): a JSON answer of Intendia is final (403, 404, 409…)
      retry: (n, err) => n < 2 && isTransient(err),
      staleTime: 10_000,
    },
  },
});

// the side chat's iframe and the page keep each other's sessions lists fresh
syncSessions(queryClient);

const rootRoute = createRootRoute({ component: Outlet });

export interface LoginSearch { retour?: string }
const loginRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/connexion', component: page(() => import('./pages/Login'), 'LoginPage'),
  validateSearch: (s: Record<string, unknown>): LoginSearch => (typeof s.retour === 'string' ? { retour: s.retour } : {}),
});
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/installation', component: page(() => import('./pages/Setup'), 'SetupPage') });
/** First-run steps after the instance (lot 9 D): full pages like /installation, signed in, `?inst=` the instance to set up. */
const stepGuard = async ({ location }: { location: { pathname: string; searchStr: string } }) => {
  const s = await queryClient.fetchQuery({ queryKey: ['setup'], queryFn: api.setup, staleTime: 0 });
  if (s.needsPassword) throw redirect({ to: '/installation' });
  if (!s.authenticated) throw redirect({ to: '/connexion', search: { retour: location.pathname + location.searchStr } });
};
const stepSearch = (s: Record<string, unknown>): StepSearch => (typeof s.inst === 'string' && s.inst ? { inst: s.inst } : {});
const providerStepRoute = createRoute({ getParentRoute: () => rootRoute, path: '/installation/fournisseur', component: page(() => import('./setup/ProviderStep'), 'ProviderStep'), beforeLoad: stepGuard, validateSearch: stepSearch });
const modelStepRoute = createRoute({ getParentRoute: () => rootRoute, path: '/installation/modele', component: page(() => import('./setup/ModelStep'), 'ModelStep'), beforeLoad: stepGuard, validateSearch: stepSearch });
const workspaceStepRoute = createRoute({ getParentRoute: () => rootRoute, path: '/installation/workspace', component: page(() => import('./setup/WorkspaceStep'), 'WorkspaceStep'), beforeLoad: stepGuard, validateSearch: stepSearch });

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: Layout,
  beforeLoad: async ({ location }) => {
    const s = await queryClient.fetchQuery({ queryKey: ['setup'], queryFn: api.setup, staleTime: 0 });
    if (s.needsPassword) throw redirect({ to: '/installation' });
    if (!s.authenticated) throw redirect({ to: '/connexion', search: { retour: location.pathname + location.searchStr } });
    if (s.needsInstance && !s.declarativeInstances) throw redirect({ to: '/installation' });
  },
});
/** The inbox: the sessions column beside the home page and the open session (no path of its own). */
const inboxRoute = createRoute({ getParentRoute: () => appRoute, id: 'inbox', component: InboxLayout });
export interface HomeSearch { nouvelle?: 1; source?: Exclude<SessionSource, 'all'> }
const sourceOf = (v: unknown): Exclude<SessionSource, 'all'> | undefined => (
  typeof v === 'string' && v !== 'all' && (SESSION_SOURCES as string[]).includes(v) ? v as Exclude<SessionSource, 'all'> : undefined
);
const homeRoute = createRoute({
  getParentRoute: () => inboxRoute, path: '/', component: HomePage,
  validateSearch: (s: Record<string, unknown>): HomeSearch => ({
    ...(s.nouvelle !== undefined ? { nouvelle: 1 as const } : {}),
    ...(sourceOf(s.source) ? { source: sourceOf(s.source) } : {}),
  }),
});
/** /sessions (page merged into the inbox): the home page, with the source filter it named. */
const sessionsRoute = createRoute({
  getParentRoute: () => appRoute, path: '/sessions',
  beforeLoad: ({ search }) => { throw redirect({ to: '/', search: sourceOf((search as { source?: unknown }).source) ? { source: (search as { source: string }).source } : {} } as never); },
});
const statusRoute = createRoute({ getParentRoute: () => appRoute, path: '/etat', component: page(() => import('./pages/Status'), 'StatusPage') });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/reglages', component: page(() => import('./pages/Settings'), 'SettingsPage') });
const helpRoute = createRoute({ getParentRoute: () => appRoute, path: '/aide', component: page(() => import('./pages/Help'), 'HelpPage') });
const workspacesRoute = createRoute({ getParentRoute: () => appRoute, path: '/w', component: page(() => import('./pages/Workspaces'), 'WorkspacesPage') });
const workspaceRoute = createRoute({ getParentRoute: () => appRoute, path: '/w/$slug', component: page(() => import('./pages/Workspace'), 'WorkspacePage') });
const filesRoute = createRoute({
  getParentRoute: () => appRoute, path: '/w/$slug/fichiers', component: page(() => import('./pages/Files'), 'FilesPage'),
  validateSearch: (s: Record<string, unknown>): FilesSearch => ({
    path: typeof s.path === 'string' && s.path ? s.path : undefined,
    f: typeof s.f === 'string' && s.f ? s.f : undefined,
    edit: s.edit === 1 || s.edit === '1' ? 1 : undefined,
  }),
});
const gitRoute = createRoute({
  getParentRoute: () => appRoute, path: '/w/$slug/git', component: page(() => import('./pages/Git'), 'GitPage'),
  validateSearch: (s: Record<string, unknown>): GitSearch => ({
    repo: typeof s.repo === 'string' ? s.repo : '',
    f: typeof s.f === 'string' && s.f ? s.f : undefined,
  }),
});
/** /liens (page removed): the share links are a tab of « Fichiers ». */
const linksRoute = createRoute({ getParentRoute: () => appRoute, path: '/liens', beforeLoad: () => { throw redirect({ to: '/files', search: { tab: 'liens' } } as never); } });
/** A session = the Chat page (its columns: chat/ChatPage.tsx); `?avec=` = the other chats of a copied link. */
const sessionRoute = createRoute({
  getParentRoute: () => inboxRoute, path: '/w/$slug/s/$sessionId', component: page(() => import('./chat/ChatPage'), 'ChatPage'),
  validateSearch: (s: Record<string, unknown>): { avec?: string } => ({ avec: typeof s.avec === 'string' && s.avec ? s.avec : undefined }),
});
/** « Chat » of the sidebar: this tab's active chat (of any instance), else the sessions. */
const chatRoute = createRoute({
  getParentRoute: () => appRoute, path: '/chat',
  beforeLoad: () => {
    const c = loadChat();
    const active = c.open.find((x) => x.id === c.active);
    if (active) throw redirect({ to: '/w/$slug/s/$sessionId', params: { slug: active.slug, sessionId: active.id } } as never);
    throw redirect({ to: '/' });
  },
});
/**
 * « Nouvelle session »: an empty session in a new chat column, right of the active one (chat/newSession.ts picks the
 * workspace). Never on a preload (the router preloads links on hover): it creates a session. One creation at a time;
 * the redirect replaces this entry, so « Précédent » never comes back here. No instance, workspace or a failure: the
 * home page, where the message box creates a session on sending.
 */
let creating: Promise<{ slug: string; id: string } | null> | null = null;
async function createChat(): Promise<{ slug: string; id: string } | null> {
  try {
    const { instances } = await queryClient.fetchQuery({ queryKey: ['instances'], queryFn: api.instances });
    const inst = resolveCurrent({ ids: instances.map((i) => i.id), tab: currentTab() });
    if (!inst) return null;
    const { workspaces } = await queryClient.fetchQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
    const slug = pickWorkspace({ workspaces, inst, chat: loadChat(), last: localStorage.getItem('intendia-last-workspace') });
    if (!slug) return null;
    const { session } = await api.createSession(slug);
    void invalidateSessionLists(queryClient);
    updateChat((c) => openBeside(c, { slug, id: session.id }));
    return { slug, id: session.id };
  } catch (err) {
    console.error('Nouvelle session', err);
    return null;
  }
}
const newChatRoute = createRoute({
  getParentRoute: () => appRoute, path: '/chat/nouvelle', preload: false,
  beforeLoad: async ({ preload }) => {
    if (preload) return;
    creating ??= createChat().finally(() => { creating = null; });
    const made = await creating;
    if (!made) throw redirect({ to: '/', search: { nouvelle: 1 }, replace: true } as never);
    throw redirect({ to: '/w/$slug/s/$sessionId', params: { slug: made.slug, sessionId: made.id }, replace: true } as never);
  },
});
/** Entry of an instance page (bookmarks, old links): the current instance of this tab, else the first. */
async function toCurrent(page: InstancePage, search?: object): Promise<never> {
  const { instances } = await queryClient.fetchQuery({ queryKey: ['instances'], queryFn: api.instances });
  const id = resolveCurrent({ ids: instances.map((i) => i.id), tab: currentTab() });
  throw id ? redirect({ to: `/i/$inst/${page}`, params: { inst: id }, ...(search ? { search } : {}) } as never) : redirect({ to: '/' });
}
const instanceFilesSearch = (s: Record<string, unknown>): InstanceFilesSearch => ({
  tab: s.tab === 'liens' ? 'liens' : undefined,
  path: typeof s.path === 'string' && s.path ? s.path : undefined,
  f: typeof s.f === 'string' && s.f ? s.f : undefined,
});
/** /files: the current instance */
const instanceFilesIndexRoute = createRoute({
  getParentRoute: () => appRoute, path: '/files', validateSearch: instanceFilesSearch,
  beforeLoad: ({ search }) => toCurrent('files', search),
});
const instanceFilesRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/files', component: page(() => import('./pages/InstanceFiles'), 'InstanceFilesPage'), validateSearch: instanceFilesSearch,
});
/** /crons: the current instance */
const cronsIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/crons', beforeLoad: () => toCurrent('crons') });
export interface CronsSearch { cron?: string; nouveau?: 1 }
const cronsRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/crons', component: page(() => import('./pages/Crons'), 'CronsPage'),
  validateSearch: (s: Record<string, unknown>): CronsSearch => ({
    ...(typeof s.cron === 'string' && parseCronKey(s.cron) ? { cron: s.cron } : {}),
    // ?nouveau=1 (the palette's « Créer une planification »): the page opens the editor, then drops it
    ...(s.nouveau === 1 || s.nouveau === '1' ? { nouveau: 1 as const } : {}),
  }),
});
/** /skills: the current instance */
const skillsIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/skills', beforeLoad: () => toCurrent('skills') });
const skillsRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/skills', component: page(() => import('./pages/Skills'), 'SkillsPage'),
  validateSearch: (s: Record<string, unknown>): SkillsSearch => ({
    profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
    skill: typeof s.skill === 'string' && s.skill.length > 0 && s.skill.length <= 200 ? s.skill : undefined,
  }),
});
/** /config: the current instance */
const configIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/config', beforeLoad: () => toCurrent('config') });
const configRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/config', component: page(() => import('./pages/Config'), 'ConfigPage'),
  validateSearch: (s: Record<string, unknown>): ConfigSearch => ({
    profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
    tab: typeof s.tab === 'string' && (CONFIG_TABS as readonly string[]).includes(s.tab) ? (s.tab as ConfigTab) : undefined,
    key: typeof s.key === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s.key) ? s.key : undefined,
  }),
});
/** /suivi: the current instance */
const monitorIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/suivi', beforeLoad: () => toCurrent('suivi') });
const monitorRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/suivi', component: page(() => import('./pages/Monitor'), 'MonitorPage'),
  validateSearch: (s: Record<string, unknown>): MonitorSearch => ({
    tab: typeof s.tab === 'string' && (MONITOR_TABS as readonly string[]).includes(s.tab) ? (s.tab as MonitorTab) : undefined,
    days: (PERIODS as readonly unknown[]).includes(Number(s.days)) ? (Number(s.days) as Period) : undefined,
    file: typeof s.file === 'string' && (LOG_FILES as readonly string[]).includes(s.file) ? s.file : undefined,
    profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
  }),
});
/** /memoire: the current instance */
const memoryIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/memoire', beforeLoad: () => toCurrent('memoire') });
const memoryRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/memoire', component: page(() => import('./pages/Memory'), 'MemoryPage'),
  validateSearch: (s: Record<string, unknown>): MemorySearch => ({
    profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
    tab: typeof s.tab === 'string' && (MEMORY_TABS as readonly string[]).includes(s.tab) ? (s.tab as MemoryTab) : undefined,
    entry: typeof s.entry === 'string' && /^memory:(memory|profile):\d{1,6}:[0-9a-f]{12}$/.test(s.entry) ? s.entry : undefined,
    skill: typeof s.skill === 'string' && s.skill.length > 0 && s.skill.length <= 200 ? s.skill : undefined,
  }),
});
/** /acces: the current instance (credential vault of Hermes) */
const accessIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/acces', beforeLoad: () => toCurrent('acces') });
const accessRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/acces', component: page(() => import('./pages/Access'), 'AccessPage'),
  validateSearch: (s: Record<string, unknown>): AccessSearch => {
    let origin: string | undefined;
    if (typeof s.origin === 'string' && s.origin.length <= 2048) {
      try {
        const u = new URL(s.origin);
        if (u.protocol === 'http:' || u.protocol === 'https:') origin = `${u.protocol}//${u.host}`;
      } catch { /* not a site: left out */ }
    }
    return {
      profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
      item: typeof s.item === 'string' && /^vault_[0-9a-f]{6,40}$/.test(s.item) ? s.item : undefined,
      add: typeof s.add === 'string' && (ACCESS_KINDS as readonly string[]).includes(s.add) ? (s.add as AccessSearch['add']) : undefined,
      origin,
      proposed: s.proposed === '1' || s.proposed === 1 ? '1' : undefined,
      replace: s.replace === '1' || s.replace === 1 ? '1' : undefined,
    };
  },
});
/** /agents: the current instance */
const agentsIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/agents', beforeLoad: () => toCurrent('agents') });
const agentsRoute = createRoute({ getParentRoute: () => appRoute, path: '/i/$inst/agents', component: page(() => import('./pages/Agents'), 'AgentsPage') });
const agentRoute = createRoute({ getParentRoute: () => appRoute, path: '/i/$inst/agents/$name', component: page(() => import('./pages/Agent'), 'AgentPage') });
/** /kanban: the current instance */
const kanbanIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/kanban', beforeLoad: () => toCurrent('kanban') });
const kanbanRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/kanban', component: page(() => import('./pages/Kanban'), 'KanbanPage'),
  validateSearch: (s: Record<string, unknown>): KanbanSearch => ({
    board: typeof s.board === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s.board) ? s.board : undefined,
    task: typeof s.task === 'string' && /^t_[a-z0-9]{4,32}$/.test(s.task) ? s.task : undefined,
  }),
});
const activityRoute = createRoute({ getParentRoute: () => appRoute, path: '/activite', component: page(() => import('./pages/Centre'), 'CentrePage') });
const externalRoute = createRoute({ getParentRoute: () => inboxRoute, path: '/i/$inst/p/$profile/s/$sessionId', component: page(() => import('./pages/ExternalSession'), 'ExternalSessionPage') });
/** A channel with several agents (lot 7), in the agents column's layout. */
const channelRoute = createRoute({ getParentRoute: () => inboxRoute, path: '/canaux/$channelId', component: page(() => import('./channels/ChannelPage'), 'ChannelPage') });

const router = createRouter({
  routeTree: rootRoute.addChildren([loginRoute, setupRoute, providerStepRoute, modelStepRoute, workspaceStepRoute, appRoute.addChildren([inboxRoute.addChildren([homeRoute, sessionRoute, externalRoute, channelRoute]), chatRoute, newChatRoute, sessionsRoute, statusRoute, settingsRoute, helpRoute, workspacesRoute, workspaceRoute, filesRoute, gitRoute, linksRoute, instanceFilesIndexRoute, instanceFilesRoute, cronsIndexRoute, cronsRoute, skillsIndexRoute, skillsRoute, configIndexRoute, configRoute, monitorIndexRoute, monitorRoute, memoryIndexRoute, memoryRoute, accessIndexRoute, accessRoute, agentsIndexRoute, agentsRoute, agentRoute, activityRoute, kanbanIndexRoute, kanbanRoute])]),
  defaultPreload: 'intent',
  defaultErrorComponent: RouteError,
  // a page whose code is still downloading (routes/lazy.ts) or whose guard is slow: shown after half a second only
  defaultPendingComponent: PagePending,
  defaultPendingMs: 500,
  defaultPendingMinMs: 300,
});

initConnection({ queryClient, router });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

// drafts of the composer older than 30 days
pruneDrafts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boundary>
        <RouterProvider router={router} />
        <DialogHost />
        <Toasts />
        <UndoHost />
      </Boundary>
    </QueryClientProvider>
  </StrictMode>,
);
