// One short JSON-RPC call on the dashboard WebSocket `/api/ws` (outside the OpenAPI): open, call, close.
// Used for `session.stats` (context, plan quota), which no HTTP route gives. The URL holds the dashboard token:
// it is never logged nor put in an error.
import { z } from 'zod';
import type { InstanceConfig } from '../config.js';
import { dashboardSocketUrl, defaultFactory, type WsFactory } from './events.js';

export class GatewaySocketError extends Error {
  /** JSON-RPC error code (-32601 = unknown method), or null for a transport failure (refused, closed, timeout). */
  constructor(readonly code: number | null, message: string) {
    super(message);
  }
}

const num = z.number().finite().nullish().catch(null);
/** `session.stats` of Hermes 0.23 (gateway/session_usage.py); every field optional, unreadable ones dropped. */
export const SessionStatsSchema = z.looseObject({
  context_tokens: num,
  context_length: num,
  plan_gauge: z.looseObject({ label: z.string().nullish().catch(null), used_bp: num, resets_at_ms: num }).nullish().catch(null),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;

export async function callGatewaySocket(
  instance: InstanceConfig, method: string, params: Record<string, unknown>,
  { factory = defaultFactory, timeoutMs = 3000 }: { factory?: WsFactory; timeoutMs?: number } = {},
): Promise<unknown> {
  let url: string;
  try {
    url = dashboardSocketUrl(instance, '/api/ws');
  } catch {
    throw new GatewaySocketError(null, 'Dashboard non configuré');
  }
  return new Promise((resolve, reject) => {
    let done = false;
    let ws: ReturnType<WsFactory> | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(1000); } catch { /* not open */ }
      fn();
    };
    // a wrong token gets no answer to the handshake: the delay covers it
    const timer = setTimeout(() => finish(() => reject(new GatewaySocketError(null, 'WebSocket du dashboard sans réponse'))), timeoutMs);
    try {
      ws = factory(url);
    } catch {
      finish(() => reject(new GatewaySocketError(null, 'Connexion au WebSocket du dashboard impossible')));
      return;
    }
    ws.addEventListener('open', () => {
      try {
        ws!.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
      } catch {
        finish(() => reject(new GatewaySocketError(null, 'Envoi sur le WebSocket du dashboard impossible')));
      }
    });
    ws.addEventListener('message', (ev) => {
      let msg: { id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg?.id !== 1) return; // events pushed by the gateway (`method: "event"`)
      if (msg.error) {
        const code = typeof msg.error.code === 'number' ? msg.error.code : null;
        const text = typeof msg.error.message === 'string' ? msg.error.message.slice(0, 200) : 'erreur';
        finish(() => reject(new GatewaySocketError(code, text)));
      } else {
        finish(() => resolve(msg.result));
      }
    });
    ws.addEventListener('error', () => finish(() => reject(new GatewaySocketError(null, 'WebSocket du dashboard en erreur'))));
    ws.addEventListener('close', () => finish(() => reject(new GatewaySocketError(null, 'WebSocket du dashboard fermé'))));
  });
}

export async function sessionStats(instance: InstanceConfig, sessionId: string, opts?: { factory?: WsFactory; timeoutMs?: number }): Promise<SessionStats> {
  return SessionStatsSchema.parse(await callGatewaySocket(instance, 'session.stats', { session_id: sessionId }, opts) ?? {});
}

/** `llm.oneshot`: one call to the auxiliary model of a task (titles…), without session or tools. Answer `{text}`. */
export async function oneshot(
  instance: InstanceConfig, params: { instructions: string; input: string; task: string; max_tokens?: number; profile?: string },
  opts?: { factory?: WsFactory; timeoutMs?: number },
): Promise<string> {
  const res = await callGatewaySocket(instance, 'llm.oneshot', params, opts);
  const text = res && typeof res === 'object' && typeof (res as { text?: unknown }).text === 'string' ? (res as { text: string }).text : null;
  if (text === null) throw new GatewaySocketError(null, 'Réponse de llm.oneshot illisible');
  return text;
}

/**
 * The WebSocket methods Intendia uses, each checked on its own: `session.stats` (see probeSessionStats) and
 * `llm.oneshot` (called without parameters: 4030 = present, -32601 = absent, no answer = absent).
 */
export async function probeSocket(instance: InstanceConfig, opts?: { factory?: WsFactory; timeoutMs?: number }): Promise<{ sessionStats: boolean; oneshot: boolean; note: string }> {
  const stats = await probeSessionStats(instance, opts);
  let one = false;
  try {
    await callGatewaySocket(instance, 'llm.oneshot', {}, opts);
    one = true;
  } catch (err) {
    one = (err as GatewaySocketError).code !== null && (err as GatewaySocketError).code !== -32601;
  }
  return { ...stats, oneshot: one };
}

/**
 * Does `session.stats` exist on this dashboard? Only when the dashboard runs inside the gateway; a standalone
 * dashboard (the usual setup) answers -32601. Any JSON-RPC answer other than -32601 (even "session not found") = yes.
 */
export async function probeSessionStats(instance: InstanceConfig, opts?: { factory?: WsFactory; timeoutMs?: number }): Promise<{ sessionStats: boolean; note: string }> {
  try {
    await callGatewaySocket(instance, 'session.stats', { session_id: 'intendia-probe' }, opts);
    return { sessionStats: true, note: 'Le WebSocket du dashboard donne le contexte et les quotas' };
  } catch (err) {
    const e = err as GatewaySocketError;
    if (e.code === -32601) return { sessionStats: false, note: 'Dashboard séparé de la passerelle : contexte estimé, quotas indisponibles' };
    if (e.code !== null) return { sessionStats: true, note: 'Le WebSocket du dashboard donne le contexte et les quotas' };
    return { sessionStats: false, note: `${e.message} : contexte estimé, quotas indisponibles` };
  }
}
