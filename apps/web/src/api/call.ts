import { t } from '../i18n';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly data?: unknown) {
    super(message);
  }
}
/** What `call()` tells the connection module (connection/connection.ts), set by `setCallHooks`. */
interface CallHooks {
  /** false: Intendia did not answer (network error, proxy 502/503/504 without JSON); true: it did. */
  network: (ok: boolean) => void;
  /** 401 `unauthenticated`: the session expired. */
  unauthenticated: () => void;
  /** A write got no answer in time: it may have gone through. */
  writeTimeout: () => void;
}
let hooks: CallHooks = { network: () => {}, unauthenticated: () => {}, writeTimeout: () => {} };
export function setCallHooks(h: Partial<CallHooks>): void {
  hooks = { ...hooks, ...h };
}
/** Browser wait for an answer: reads 60 s, writes 150 s (above the longest synchronous server call, 120 s). */
export const READ_TIMEOUT_MS = 60_000;
export const WRITE_TIMEOUT_MS = 150_000;
const proxyDown = (status: number, data: unknown) => [502, 503, 504].includes(status) && data == null;
/** Passing failure worth retrying: Intendia unreachable, or a proxy in front of a stopped Intendia (no JSON body). */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  const code = err.data && typeof err.data === 'object' && 'code' in err.data ? (err.data as { code?: unknown }).code : undefined;
  return (err.status === 0 && code === 'network') || proxyDown(err.status, err.data);
}
export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const ms = method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
  let res: Response;
  let data: unknown;
  try {
    res = await fetch(`/x${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Intendia': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    data = await res.json().catch((e: unknown) => {
      if (isTimeout(e)) throw e;
      return null;
    });
  } catch (e) {
    if (isTimeout(e)) {
      const s = Math.round(ms / 1000);
      if (method !== 'GET') hooks.writeTimeout();
      throw new ApiError(0, method === 'GET'
        ? t("Pas de réponse d'Intendia après {s} s", { s })
        : t("Pas de réponse d'Intendia après {s} s : l'action a peut-être abouti, vérifiez avant de recommencer", { s }),
      { code: 'timeout', timeoutMs: ms });
    }
    if (e instanceof TypeError) {
      hooks.network(false);
      throw new ApiError(0, t('Serveur Intendia injoignable'), { code: 'network' });
    }
    throw e;
  }
  hooks.network(!proxyDown(res.status, data));
  if (!res.ok) {
    if (res.status === 401 && data && typeof data === 'object' && (data as { code?: unknown }).code === 'unauthenticated') hooks.unauthenticated();
    const msg = (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string')
      ? data.error
      : t('Réponse inattendue du serveur Intendia (HTTP {status})', { status: res.status });
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}
function isTimeout(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
}
