// Kanban live events: the dashboard WebSocket, opened here only (its token never leaves the server).
import type { InstanceConfig } from '../config.js';
import { msg } from '../i18n/index.js';

/** Minimal WebSocket surface used here (the global WebSocket of Node, or a test double). */
export interface WsLike {
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: { data?: unknown; code?: number }) => void): void;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}
export type WsFactory = (url: string) => WsLike;

export interface KanbanEvent { id: number; task_id: string | null; run_id: number | null; kind: string }

export interface KanbanEventHandlers {
  onOpen?: () => void;
  /** A batch of events (the task ids they touch). */
  onEvents: (events: KanbanEvent[]) => void;
  /** The connection could not open, or closed: the caller ends its stream. */
  onClose: (reason: string) => void;
}

/** ws(s)://<dashboard base><path>?<query>&token= (base path of the dashboard URL kept). Never log it: it holds the token. */
export function dashboardSocketUrl(instance: InstanceConfig, path: string, query: Record<string, string> = {}): string {
  if (!instance.dashboard || !instance.dashboardToken) throw new Error(msg('Dashboard non configuré'));
  const u = new URL(instance.dashboard);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = `${u.pathname.replace(/\/+$/, '')}${path}`;
  u.search = new URLSearchParams({ ...query, token: instance.dashboardToken }).toString();
  return u.toString();
}

/** ws(s)://<dashboard base>/api/plugins/kanban/events?board=&token= */
export function kanbanEventsUrl(instance: InstanceConfig, board: string): string {
  return dashboardSocketUrl(instance, '/api/plugins/kanban/events', { board });
}

export const defaultFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike;

/** Hermes 0.23.0 never answers the handshake of a wrong token: past this delay the connection is given up. */
export const OPEN_TIMEOUT_MS = 10_000;

/** Opens the events of one board. Messages and errors never carry the URL (it holds the token). */
export function openKanbanEvents(
  instance: InstanceConfig, board: string, handlers: KanbanEventHandlers,
  factory: WsFactory = defaultFactory, openTimeoutMs = OPEN_TIMEOUT_MS,
): { close: () => void } {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = (reason: string) => {
    clearTimeout(timer);
    if (closed) return;
    closed = true;
    handlers.onClose(reason);
  };
  let ws: WsLike;
  try {
    ws = factory(kanbanEventsUrl(instance, board));
  } catch {
    queueMicrotask(() => end(msg('Connexion au flux du kanban impossible')));
    return { close: () => { closed = true; } };
  }
  timer = setTimeout(() => {
    end(msg('Flux du kanban sans réponse'));
    try { ws.close(1000); } catch { /* not open */ }
  }, openTimeoutMs);
  ws.addEventListener('open', () => {
    clearTimeout(timer);
    handlers.onOpen?.();
  });
  ws.addEventListener('message', (ev) => {
    if (closed) return;
    try {
      const data = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as { events?: unknown };
      const events = Array.isArray(data.events) ? data.events.filter((e): e is KanbanEvent => Boolean(e) && typeof (e as KanbanEvent).kind === 'string') : [];
      if (events.length) handlers.onEvents(events);
    } catch {
      // not JSON: ignored
    }
  });
  ws.addEventListener('error', () => end(msg('Flux du kanban interrompu')));
  ws.addEventListener('close', (ev) => end(ev.code === 1008 ? msg('Flux du kanban refusé par Hermes') : msg('Flux du kanban fermé')));
  return {
    close: () => {
      clearTimeout(timer);
      closed = true;
      try { ws.close(1000); } catch { /* already closed */ }
    },
  };
}
