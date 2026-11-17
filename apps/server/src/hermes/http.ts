/**
 * The ONLY place where Intendia talks HTTP to Hermes.
 * Allowed importers: src/hermes, src/connectors, src/compat, src/cli (enforced by test/boundaries.test.ts).
 */
import type { InstanceConfig } from '../config.js';

export type Via = 'api' | 'dash';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type HermesErrorKind = 'unconfigured' | 'network' | 'timeout' | 'http' | 'schema';

export class HermesError extends Error {
  constructor(
    readonly kind: HermesErrorKind,
    message: string,
    readonly detail: {
      via?: Via; method?: string; path?: string; status?: number; body?: string;
      /** `Retry-After` header of a non-2xx answer. */
      retryAfter?: string;
      /** The caller aborted the request (browser gone): never a sign of an outage. */
      aborted?: true;
    } = {},
    /**
     * Made by HermesHttp (or callOp) itself, message in English for the logs: onError builds the user's message. A
     * service that throws its own HermesError (raw = false) already wrote that message.
     */
    readonly raw = false,
  ) {
    super(message);
    this.name = 'HermesError';
  }
}

/**
 * A passing failure of Hermes (outage): network error (not an abort by the caller), timeout, or HTTP 502/503/504.
 * A 500, a 404 or a schema error stays a normal compatibility failure.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof HermesError)) return false;
  if (err.kind === 'network') return !err.detail.aborted;
  if (err.kind === 'timeout') return true;
  return err.kind === 'http' && [502, 503, 504].includes(err.detail.status ?? 0);
}

/**
 * A 404 for a route Hermes does not have (not a missing session or file): FastAPI's `{"detail":"Not Found"}`, the
 * dashboard's catch-all `{"detail":"No such API endpoint: /api/…"}` (Hermes 0.23, `web_server_dashboard.py`), or
 * aiohttp's `404: Not Found` (API server).
 */
export function isMissingRoute(body: string | undefined): boolean {
  const text = (body ?? '').trim();
  if (text.startsWith('404: Not Found')) return true;
  try {
    const detail = (JSON.parse(text) as { detail?: unknown } | null)?.detail;
    return detail === 'Not Found' || (typeof detail === 'string' && detail.startsWith('No such API endpoint: '));
  } catch {
    return false;
  }
}

/**
 * Told about the failures of a client's requests (runtime signals for the compatibility report): network errors and
 * timeouts (never an abort by the caller), non-2xx answers of `json()`, 401/403 of `request()`, schema errors.
 */
export interface HermesObserver {
  onError?(err: HermesError): void;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Hermes profile: /p/<profile>/ prefix on the API server, ?profile= on the dashboard. */
  profile?: string;
  headers?: Record<string, string>;
  /** No bearer token (a public path of Hermes, called on behalf of a browser). */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** Overrides the default timeout; 0 disables it (SSE streams). */
  timeoutMs?: number;
  /** Streamed body sent as is (multipart upload), instead of the JSON `body`. */
  rawBody?: ReadableStream<Uint8Array>;
  /** Content-Type of `rawBody`. */
  contentType?: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;

export class HermesHttp {
  constructor(
    readonly instance: InstanceConfig,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
    /** Runtime signals; compatibility checks and probes run without one, so they never trigger themselves. */
    readonly observer?: HermesObserver,
  ) {}

  /** Tells the observer, which must never break the request. */
  notify(err: HermesError): void {
    try {
      this.observer?.onError?.(err);
    } catch {
      // ignored
    }
  }

  hasDashboard(): boolean {
    return Boolean(this.instance.dashboard && this.instance.dashboardToken);
  }

  private target(via: Via, profile: string | undefined): { base: string; token: string; prefix: string } {
    if (via === 'api') {
      if (profile && profile !== 'default') {
        const key = this.instance.profileKeys[profile];
        if (!key) throw new HermesError('unconfigured', `No API key configured for profile "${profile}"`, { via }, true);
        return { base: this.instance.api, token: key, prefix: `/p/${encodeURIComponent(profile)}` };
      }
      return { base: this.instance.api, token: this.instance.apiKey, prefix: '' };
    }
    if (!this.instance.dashboard || !this.instance.dashboardToken) {
      throw new HermesError('unconfigured', 'Dashboard URL or token not configured for this instance', { via }, true);
    }
    return { base: this.instance.dashboard, token: this.instance.dashboardToken, prefix: '' };
  }

  /** Sends the request; the timeout stays armed until `release()` (or an error). */
  private async open(via: Via, method: Method, path: string, opts: RequestOptions) {
    const t = this.target(via, opts.profile);
    // keep any base path of the configured URL (reverse-proxied Hermes)
    const full = new URL(t.base.replace(/\/$/, '') + t.prefix + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) full.searchParams.set(k, String(v));
    if (via === 'dash' && opts.profile) full.searchParams.set('profile', opts.profile);

    const headers: Record<string, string> = { ...(opts.anonymous ? {} : { Authorization: `Bearer ${t.token}` }), Accept: 'application/json', ...opts.headers };
    let body: string | ReadableStream<Uint8Array> | undefined;
    if (opts.rawBody) {
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
      body = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const detail = { via, method, path };
    // an already aborted caller (browser gone): no request at all
    if (opts.signal?.aborted) throw new HermesError('network', `${via} ${method} ${path}: aborted`, { ...detail, aborted: true }, true);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : undefined;
    const onAbort = () => controller.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    /** Clears the timeout; the abort listener stays only while a streamed body is still read (`keepAbort`). */
    const release = (keepAbort = false) => {
      if (timer) clearTimeout(timer);
      if (!keepAbort) opts.signal?.removeEventListener('abort', onAbort);
    };
    /** HermesError for a failure while fetching or reading the body (told to the observer unless the caller aborted). */
    const fail = (err: unknown) => {
      release();
      if (opts.signal?.aborted) return new HermesError('network', `${via} ${method} ${path}: aborted`, { ...detail, aborted: true }, true);
      const out = controller.signal.aborted
        ? new HermesError('timeout', `${via} ${method} ${path}: no answer after ${timeoutMs} ms`, detail, true)
        : new HermesError('network', `${via} ${method} ${path}: ${(err as Error).message}`, detail, true);
      this.notify(out);
      return out;
    };
    try {
      const init: RequestInit & { duplex?: 'half' } = { method, headers, body, signal: controller.signal };
      if (opts.rawBody) init.duplex = 'half'; // required by fetch for a streamed request body
      const res = await this.fetchImpl(full.toString(), init);
      return { res, release, fail };
    } catch (err) {
      throw fail(err);
    }
  }

  /** Raw response (SSE streams): fetch resolves once headers arrive, the timeout never cuts the body. */
  async request(via: Via, method: Method, path: string, opts: RequestOptions = {}): Promise<Response> {
    const { res, release } = await this.open(via, method, path, opts);
    // the abort of the browser must still cut the streamed body
    release(true);
    // a refused token is a signal; the caller reads the answer as before
    if ((res.status === 401 || res.status === 403) && !opts.anonymous) {
      this.notify(new HermesError('http', `${via} ${method} ${path}: HTTP ${res.status}`, { via, method, path, status: res.status }, true));
    }
    return res;
  }

  /** JSON request; non-2xx becomes a HermesError carrying the status. */
  async json(via: Via, method: Method, path: string, opts: RequestOptions = {}): Promise<unknown> {
    // the timeout covers the body too: a Hermes that sends headers and then stalls must not hang a probe
    const { res, release, fail } = await this.open(via, method, path, opts);
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw fail(err);
    }
    release();
    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after') ?? undefined;
      const err = new HermesError('http', `${via} ${method} ${path}: HTTP ${res.status}`, {
        via, method, path, status: res.status, body: text.slice(0, 500), ...(retryAfter ? { retryAfter } : {}),
      }, true);
      if (!(opts.anonymous && (res.status === 401 || res.status === 403))) this.notify(err);
      throw err;
    }
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch {
      const err = new HermesError('schema', `${via} ${method} ${path}: response is not JSON`, { via, method, path, status: res.status }, true);
      this.notify(err);
      throw err;
    }
  }
}
