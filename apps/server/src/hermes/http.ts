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
    readonly detail: { via?: Via; method?: string; path?: string; status?: number; body?: string } = {},
  ) {
    super(message);
    this.name = 'HermesError';
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Hermes profile: /p/<profile>/ prefix on the API server, ?profile= on the dashboard. */
  profile?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Overrides the default timeout; 0 disables it (SSE streams). */
  timeoutMs?: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;

export class HermesHttp {
  constructor(
    readonly instance: InstanceConfig,
    private readonly fetchImpl: FetchLike = (i, init) => fetch(i, init),
  ) {}

  hasDashboard(): boolean {
    return Boolean(this.instance.dashboard && this.instance.dashboardToken);
  }

  private target(via: Via, profile: string | undefined): { base: string; token: string; prefix: string } {
    if (via === 'api') {
      if (profile && profile !== 'default') {
        const key = this.instance.profileKeys[profile];
        if (!key) throw new HermesError('unconfigured', `No API key configured for profile "${profile}"`, { via });
        return { base: this.instance.api, token: key, prefix: `/p/${encodeURIComponent(profile)}` };
      }
      return { base: this.instance.api, token: this.instance.apiKey, prefix: '' };
    }
    if (!this.instance.dashboard || !this.instance.dashboardToken) {
      throw new HermesError('unconfigured', 'Dashboard URL or token not configured for this instance', { via });
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

    const headers: Record<string, string> = { Authorization: `Bearer ${t.token}`, Accept: 'application/json', ...opts.headers };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs) : undefined;
    opts.signal?.addEventListener('abort', () => controller.abort(opts.signal?.reason), { once: true });
    const detail = { via, method, path };
    const release = () => { if (timer) clearTimeout(timer); };
    /** HermesError for a failure while fetching or reading the body. */
    const fail = (err: unknown) => {
      release();
      if (controller.signal.aborted && !opts.signal?.aborted) {
        return new HermesError('timeout', `${via} ${method} ${path}: no answer after ${timeoutMs} ms`, detail);
      }
      return new HermesError('network', `${via} ${method} ${path}: ${(err as Error).message}`, detail);
    };
    try {
      const res = await this.fetchImpl(full.toString(), { method, headers, body, signal: controller.signal });
      return { res, release, fail };
    } catch (err) {
      throw fail(err);
    }
  }

  /** Raw response (SSE streams): fetch resolves once headers arrive, the timeout never cuts the body. */
  async request(via: Via, method: Method, path: string, opts: RequestOptions = {}): Promise<Response> {
    const { res, release } = await this.open(via, method, path, opts);
    release();
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
      throw new HermesError('http', `${via} ${method} ${path}: HTTP ${res.status}`, {
        via, method, path, status: res.status, body: text.slice(0, 500),
      });
    }
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new HermesError('schema', `${via} ${method} ${path}: response is not JSON`, { via, method, path, status: res.status });
    }
  }
}
