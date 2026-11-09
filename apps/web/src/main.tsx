import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute, createRoute, createRouter, Outlet, redirect, RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { StatusPage } from './pages/Status';
import '@fontsource-variable/instrument-sans';
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
const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage });
const statusRoute = createRoute({ getParentRoute: () => appRoute, path: '/etat', component: StatusPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/reglages', component: SettingsPage });

const router = createRouter({
  routeTree: rootRoute.addChildren([loginRoute, setupRoute, appRoute.addChildren([homeRoute, statusRoute, settingsRoute])]),
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
