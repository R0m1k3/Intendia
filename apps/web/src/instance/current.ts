import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useCallback, useSyncExternalStore } from 'react';
import { api, type PublicInstance } from '../api';

/** Pages that exist per instance, under /i/<inst>/<page>. */
export const INSTANCE_PAGES = ['crons', 'skills', 'agents', 'config', 'kanban'] as const;
export type InstancePage = (typeof INSTANCE_PAGES)[number];
const isInstancePage = (v: string | undefined): v is InstancePage => (INSTANCE_PAGES as readonly string[]).includes(v ?? '');

const KEY = 'intendia-instance';

/** Where a link leads: options for the router's `Link` / `navigate`. */
export interface NavTarget { to: string; params?: Record<string, string>; hash?: string; replace?: boolean }

/** The current instance: the one named by the address, else this tab's, else the first; null when there is none. */
export function resolveCurrent({ ids, fromUrl, tab }: { ids: readonly string[]; fromUrl?: string; tab?: string | null }): string | null {
  if (fromUrl && ids.includes(fromUrl)) return fromUrl;
  if (tab && ids.includes(tab)) return tab;
  return ids[0] ?? null;
}

/** The address of an instance page. */
export const instancePath = (page: InstancePage, id: string): NavTarget => ({ to: `/i/$inst/${page}`, params: { inst: id } });

/** Target of a sidebar entry: its instance page when it has one and an instance is known, else its address. */
export const navTarget = (entry: { to: string; page?: InstancePage }, id: string | null): NavTarget =>
  entry.page && id ? instancePath(entry.page, id) : { to: entry.to };

/** Where to go when another instance is chosen on `pathname`. */
export function switchTarget(pathname: string, id: string): NavTarget {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'i') {
    const page = parts[2];
    return isInstancePage(page) ? instancePath(page, id) : { to: '/' };
  }
  if (parts[0] === 'w' && parts.length > 1) return { to: '/' };
  // the same page, its content changes: replace, so "Back" does not stay on the same address
  return { to: pathname || '/', replace: true };
}

// ---- this tab's value: a module store (every component of the tab follows), kept in sessionStorage (reload) and
// localStorage (a new tab starts from the last one chosen). No `storage` listener: a tab never changes another.

function readStored(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (private browsing)
  }
}

let tab: string | null = readStored();
const listeners = new Set<() => void>();

/** This tab's instance, outside React (route `beforeLoad`). */
export const currentTab = (): string | null => tab;

export function setTab(id: string): void {
  if (tab === id) return;
  tab = id;
  try {
    sessionStorage.setItem(KEY, id);
    localStorage.setItem(KEY, id);
  } catch {
    // not kept: lasts until the page is reloaded
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The instance named by the current address: /i/<inst>/…, a workspace's instance, /etat#<inst>; null = not yet known. */
export function useUrlInstance(): { fromUrl?: string; pending: boolean } {
  const params = useParams({ strict: false }) as { inst?: string; slug?: string };
  const hash = useRouterState({ select: (s) => (s.location.pathname === '/etat' ? s.location.hash : '') });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces, enabled: Boolean(params.slug) && !params.inst });
  if (params.inst) return { fromUrl: params.inst, pending: false };
  if (params.slug) {
    if (!workspaces.data) return { pending: !workspaces.isError };
    return { fromUrl: workspaces.data.workspaces.find((w) => w.slug === params.slug)?.instanceId, pending: false };
  }
  return { fromUrl: hash || undefined, pending: false };
}

/** The current instance; `id` is null while unknown (address being resolved, instances loading, none). */
export function useCurrentInstance(): {
  id: string | null; instance: PublicInstance | null; instances: PublicInstance[]; select: (id: string) => void;
} {
  const current = useSyncExternalStore(subscribe, currentTab);
  const list = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const { fromUrl, pending } = useUrlInstance();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const instances = list.data?.instances ?? [];
  const id = pending || !list.data ? null : resolveCurrent({ ids: instances.map((i) => i.id), fromUrl, tab: current });
  const select = useCallback((next: string) => {
    setTab(next);
    void navigate(switchTarget(pathname, next) as never);
  }, [navigate, pathname]);
  return { id, instance: instances.find((i) => i.id === id) ?? null, instances, select };
}
