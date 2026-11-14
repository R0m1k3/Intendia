// One short JSON-RPC call on the dashboard WebSocket `/api/ws` (outside the OpenAPI): open, call, close.
// Used for `session.stats` (context, plan quota), which no HTTP route gives. The URL holds the dashboard token:
// it is never logged nor put in an error.
import { z } from 'zod';
import type { InstanceConfig } from '../config.js';
import { msg } from '../i18n/index.js';
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
    throw new GatewaySocketError(null, msg('Dashboard non configuré'));
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
    const timer = setTimeout(() => finish(() => reject(new GatewaySocketError(null, msg('WebSocket du dashboard sans réponse')))), timeoutMs);
    try {
      ws = factory(url);
    } catch {
      finish(() => reject(new GatewaySocketError(null, msg('Connexion au WebSocket du dashboard impossible'))));
      return;
    }
    ws.addEventListener('open', () => {
      try {
        ws!.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
      } catch {
        finish(() => reject(new GatewaySocketError(null, msg('Envoi sur le WebSocket du dashboard impossible'))));
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
    ws.addEventListener('error', () => finish(() => reject(new GatewaySocketError(null, msg('WebSocket du dashboard en erreur')))));
    ws.addEventListener('close', () => finish(() => reject(new GatewaySocketError(null, msg('WebSocket du dashboard fermé')))));
  });
}

export async function sessionStats(instance: InstanceConfig, sessionId: string, opts?: { factory?: WsFactory; timeoutMs?: number }): Promise<SessionStats> {
  return SessionStatsSchema.parse(await callGatewaySocket(instance, 'session.stats', { session_id: sessionId }, opts) ?? {});
}

/** `llm.oneshot`: one call to the auxiliary model of a task (titles…), without session or tools. Answer `{text}`. */
export async function oneshot(
  instance: InstanceConfig,
  params: ({ instructions: string; input: string } | { template: string; variables: Record<string, string> }) & { task: string; max_tokens?: number; profile?: string },
  opts?: { factory?: WsFactory; timeoutMs?: number },
): Promise<string> {
  const res = await callGatewaySocket(instance, 'llm.oneshot', params, opts);
  const text = res && typeof res === 'object' && typeof (res as { text?: unknown }).text === 'string' ? (res as { text: string }).text : null;
  if (text === null) throw new GatewaySocketError(null, msg('Réponse de llm.oneshot illisible'));
  return text;
}

const VAULT_TIMEOUT_MS = 10_000;
const str = z.string().nullish().catch(null);
/** One item of `vault.list` (Hermes 0.23, tui_gateway/methods_vault.py): metadata only, never a secret. */
export const VaultItemSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(['login', 'payment', 'address']),
  label: z.string(),
  origin: str,
  created_at: str,
  identifier: str,
  identifier_type: str,
  has_otp: z.boolean().nullish().catch(null),
  /** `local` = the vault of Hermes; `onepassword` / `bitwarden` = an unlocked external password manager */
  backend: str,
});
export type HermesVaultItem = z.infer<typeof VaultItemSchema>;
export interface HermesVaultAdd { kind: 'login' | 'payment' | 'address'; label: string; origin: string; secret: Record<string, string> }
type VaultOpts = { factory?: WsFactory; timeoutMs?: number };

/** `vault.list` of a profile; unreadable items are skipped. */
export async function vaultList(instance: InstanceConfig, profile: string, opts: VaultOpts = {}): Promise<HermesVaultItem[]> {
  const res = await callGatewaySocket(instance, 'vault.list', { profile }, { timeoutMs: VAULT_TIMEOUT_MS, ...opts });
  const raw = res && typeof res === 'object' ? (res as { items?: unknown }).items : null;
  if (!Array.isArray(raw)) throw new GatewaySocketError(null, msg('Réponse de vault.list illisible'));
  return raw.flatMap((item) => {
    const r = VaultItemSchema.safeParse(item);
    return r.success ? [r.data] : [];
  });
}

/** `vault.add`: the secret goes straight to Hermes' encrypted store. Answer: the new item's handle. */
export async function vaultAdd(instance: InstanceConfig, profile: string, body: HermesVaultAdd, opts: VaultOpts = {}): Promise<string> {
  const res = await callGatewaySocket(instance, 'vault.add', { profile, ...body }, { timeoutMs: VAULT_TIMEOUT_MS, ...opts });
  const id = res && typeof res === 'object' ? (res as { id?: unknown }).id : null;
  if (typeof id !== 'string') throw new GatewaySocketError(null, msg('Réponse de vault.add illisible'));
  return id;
}

/** `vault.remove`: true when an item of the local vault was removed. */
export async function vaultRemove(instance: InstanceConfig, profile: string, id: string, opts: VaultOpts = {}): Promise<boolean> {
  const res = await callGatewaySocket(instance, 'vault.remove', { profile, id }, { timeoutMs: VAULT_TIMEOUT_MS, ...opts });
  return Boolean(res && typeof res === 'object' && (res as { removed?: unknown }).removed === true);
}

/**
 * Is a JSON-RPC method there? Called with parameters it refuses (no side effect): any JSON-RPC error other than
 * -32601 = present; -32601 or no answer = absent.
 */
async function hasMethod(instance: InstanceConfig, method: string, opts?: VaultOpts): Promise<boolean> {
  try {
    await callGatewaySocket(instance, method, {}, opts);
    return true;
  } catch (err) {
    return (err as GatewaySocketError).code !== null && (err as GatewaySocketError).code !== -32601;
  }
}

/**
 * The WebSocket methods Intendia uses, each checked on its own: `session.stats` (see probeSessionStats),
 * `llm.oneshot` (called without parameters: 4030 = present) and the credential vault (`vault.remove {}`: 5095).
 */
export async function probeSocket(instance: InstanceConfig, opts?: { factory?: WsFactory; timeoutMs?: number }): Promise<{ sessionStats: boolean; oneshot: boolean; vault: boolean; note: string }> {
  const stats = await probeSessionStats(instance, opts);
  const one = await hasMethod(instance, 'llm.oneshot', opts);
  // `vault.remove` without an id: 5095 "id is required" before the vault is opened (nothing read)
  const vault = await hasMethod(instance, 'vault.remove', opts);
  return { ...stats, oneshot: one, vault };
}

/**
 * Does `session.stats` exist on this dashboard? Only when the dashboard runs inside the gateway; a standalone
 * dashboard (the usual setup) answers -32601. Any JSON-RPC answer other than -32601 (even "session not found") = yes.
 */
export async function probeSessionStats(instance: InstanceConfig, opts?: { factory?: WsFactory; timeoutMs?: number }): Promise<{ sessionStats: boolean; note: string }> {
  try {
    await callGatewaySocket(instance, 'session.stats', { session_id: 'intendia-probe' }, opts);
    return { sessionStats: true, note: msg('Le WebSocket du dashboard donne le contexte et les quotas') };
  } catch (err) {
    const e = err as GatewaySocketError;
    if (e.code === -32601) return { sessionStats: false, note: msg('Dashboard séparé de la passerelle : contexte estimé, quotas indisponibles') };
    if (e.code !== null) return { sessionStats: true, note: msg('Le WebSocket du dashboard donne le contexte et les quotas') };
    return { sessionStats: false, note: msg('{error} : contexte estimé, quotas indisponibles', { error: e.message }) };
  }
}
