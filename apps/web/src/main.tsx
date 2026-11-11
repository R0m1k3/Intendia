import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute, createRoute, createRouter, Outlet, redirect, RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import { currentTab, resolveCurrent, type InstancePage } from './instance/current';
import { DialogHost } from './components/Dialog';
import { UndoHost } from './sessions/UndoBar';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { StatusPage } from './pages/Status';
import { ActivityPage } from './pages/Activity';
import { AgentPage } from './pages/Agent';
import { AgentsPage } from './pages/Agents';
import { CronsPage } from './pages/Crons';
import { KanbanPage, type KanbanSearch } from './pages/Kanban';
import { SkillsPage, type SkillsSearch } from './pages/Skills';
import { CONFIG_TABS, ConfigPage, type ConfigSearch, type ConfigTab } from './pages/Config';
import { ExternalSessionPage } from './pages/ExternalSession';
import { FilesPage, type FilesSearch } from './pages/Files';
import { InstanceFilesPage, type InstanceFilesSearch } from './pages/InstanceFiles';
import { SessionPage } from './pages/Session';
import { SessionsPage, type SessionsSearch } from './pages/Sessions';
import { WorkspacePage } from './pages/Workspace';
import { WorkspacesPage } from './pages/Workspaces';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

const savedTheme = localStorage.getItem('intendia-theme');
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.classList.add(savedTheme);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 2,
      staleTime: 10_000,
    },
  },
});

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/connexion', component: LoginPage });
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/installation', component: SetupPage });

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: Layout,
  beforeLoad: async () => {
    const s = await queryClient.fetchQuery({ queryKey: ['setup'], queryFn: api.setup, staleTime: 0 });
    if (s.needsPassword) throw redirect({ to: '/installation' });
    if (!s.authenticated) throw redirect({ to: '/connexion' });
    if (s.needsInstance && !s.declarativeInstances) throw redirect({ to: '/installation' });
  },
});
export interface HomeSearch { nouvelle?: 1 }
const homeRoute = createRoute({
  getParentRoute: () => appRoute, path: '/', component: HomePage,
  validateSearch: (s: Record<string, unknown>): HomeSearch => (s.nouvelle !== undefined ? { nouvelle: 1 } : {}),
});
const sessionsRoute = createRoute({
  getParentRoute: () => appRoute, path: '/sessions', component: SessionsPage,
  validateSearch: (s: Record<string, unknown>): SessionsSearch => (
    s.source === 'intendia' || s.source === 'telegram' || s.source === 'cron' ? { source: s.source } : {}
  ),
});
const statusRoute = createRoute({ getParentRoute: () => appRoute, path: '/etat', component: StatusPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/reglages', component: SettingsPage });
const workspacesRoute = createRoute({ getParentRoute: () => appRoute, path: '/w', component: WorkspacesPage });
const workspaceRoute = createRoute({ getParentRoute: () => appRoute, path: '/w/$slug', component: WorkspacePage });
const filesRoute = createRoute({
  getParentRoute: () => appRoute, path: '/w/$slug/fichiers', component: FilesPage,
  validateSearch: (s: Record<string, unknown>): FilesSearch => ({
    path: typeof s.path === 'string' && s.path ? s.path : undefined,
    f: typeof s.f === 'string' && s.f ? s.f : undefined,
  }),
});
/** /liens (page removed): the share links are a tab of « Fichiers ». */
const linksRoute = createRoute({ getParentRoute: () => appRoute, path: '/liens', beforeLoad: () => { throw redirect({ to: '/files', search: { tab: 'liens' } } as never); } });
const sessionRoute = createRoute({ getParentRoute: () => appRoute, path: '/w/$slug/s/$sessionId', component: SessionPage });
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
  getParentRoute: () => appRoute, path: '/i/$inst/files', component: InstanceFilesPage, validateSearch: instanceFilesSearch,
});
/** /crons: the current instance */
const cronsIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/crons', beforeLoad: () => toCurrent('crons') });
const cronsRoute = createRoute({ getParentRoute: () => appRoute, path: '/i/$inst/crons', component: CronsPage });
/** /skills: the current instance */
const skillsIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/skills', beforeLoad: () => toCurrent('skills') });
const skillsRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/skills', component: SkillsPage,
  validateSearch: (s: Record<string, unknown>): SkillsSearch => ({
    profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
  }),
});
/** /config: the current instance */
const configIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/config', beforeLoad: () => toCurrent('config') });
const configRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/config', component: ConfigPage,
  validateSearch: (s: Record<string, unknown>): ConfigSearch => ({
    profile: typeof s.profile === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.profile) ? s.profile : undefined,
    tab: typeof s.tab === 'string' && (CONFIG_TABS as readonly string[]).includes(s.tab) ? (s.tab as ConfigTab) : undefined,
    key: typeof s.key === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s.key) ? s.key : undefined,
  }),
});
/** /agents: the current instance */
const agentsIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/agents', beforeLoad: () => toCurrent('agents') });
const agentsRoute = createRoute({ getParentRoute: () => appRoute, path: '/i/$inst/agents', component: AgentsPage });
const agentRoute = createRoute({ getParentRoute: () => appRoute, path: '/i/$inst/agents/$name', component: AgentPage });
/** /kanban: the current instance */
const kanbanIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/kanban', beforeLoad: () => toCurrent('kanban') });
const kanbanRoute = createRoute({
  getParentRoute: () => appRoute, path: '/i/$inst/kanban', component: KanbanPage,
  validateSearch: (s: Record<string, unknown>): KanbanSearch => ({
    board: typeof s.board === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s.board) ? s.board : undefined,
    task: typeof s.task === 'string' && /^t_[a-z0-9]{4,32}$/.test(s.task) ? s.task : undefined,
  }),
});
const activityRoute = createRoute({ getParentRoute: () => appRoute, path: '/activite', component: ActivityPage });
const externalRoute = createRoute({ getParentRoute: () => appRoute, path: '/i/$inst/p/$profile/s/$sessionId', component: ExternalSessionPage });

const router = createRouter({
  routeTree: rootRoute.addChildren([loginRoute, setupRoute, appRoute.addChildren([homeRoute, sessionsRoute, statusRoute, settingsRoute, workspacesRoute, workspaceRoute, filesRoute, linksRoute, instanceFilesIndexRoute, instanceFilesRoute, sessionRoute, externalRoute, cronsIndexRoute, cronsRoute, skillsIndexRoute, skillsRoute, configIndexRoute, configRoute, agentsIndexRoute, agentsRoute, agentRoute, activityRoute, kanbanIndexRoute, kanbanRoute])]),
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <DialogHost />
      <UndoHost />
    </QueryClientProvider>
  </StrictMode>,
);
