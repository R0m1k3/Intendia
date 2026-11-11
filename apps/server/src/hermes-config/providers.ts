import type { z } from 'zod';
import type { CompatService } from '../compat/service.js';
import {
  ModelOptionsSchema, OAuthPollSchema, OAuthProvidersSchema, OAuthStartSchema, PoolAddSchema, PoolSchema,
} from '../connectors/config/index.js';
import { callOp, HermesError, type CallOptions } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError } from '../workspaces/service.js';
import { Masker } from './mask.js';
import { ConfigInputError, toConfigError, type ConfigService } from './service.js';

/**
 * Provider accounts (subscriptions connected by a device code) and API keys of the credential pool, per instance
 * and profile. Hermes keeps them in the profile's auth.json, not in its config file: no version check here, but a
 * history copy of the config file before a login (Hermes may set the main model when a login is approved).
 * Only the fields below reach the browser: never `token_preview` (part of a key) nor `source_label` (may be a path
 * of the Hermes server).
 */

export interface PublicAccount {
  id: string; name: string; flow: 'device_code' | 'external';
  cliCommand: string | null; docsUrl: string | null;
  disconnectable: boolean; disconnectHint: string | null;
  connected: boolean; expiresAt: string | null;
}
export interface PublicPoolKey { provider: string; id: string; label: string; source: string; lastStatus: string | null }
export interface ProvidersInfo {
  accounts: PublicAccount[] | null;
  keys: PublicPoolKey[] | null;
  keyProviders: { slug: string; name: string }[];
}
export interface ConnectStart { sessionId: string; userCode: string; verificationUrl: string; pollInterval: number | null; expiresIn: number | null }
export interface ConnectPoll { status: string; error: string | null; model: string | null }

type Ctx = { http: ReturnType<CompatService['http']>; report: ReturnType<CompatService['get']>; instanceId: string; profile: string };

const MANUAL = 'manual';

function expiresText(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  return null;
}

export class ProvidersService {
  private readonly mask: Masker;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    secret: string,
    private readonly config: ConfigService,
  ) {
    this.mask = new Masker(secret);
  }

  private ctx(instanceId: string, profile: string): Ctx {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId), instanceId, profile };
  }

  private can(ctx: Ctx, op: string): boolean {
    return Boolean(ctx.report?.modules.find((m) => m.id === 'config')?.ops[op]?.ok);
  }

  private async call<T>(ctx: Ctx, op: string, opts: CallOptions = {}, what = 'Introuvable', scrub?: (s: string) => string): Promise<T> {
    try {
      return await callOp<T>(ctx.http, ctx.report, 'config', op, { profile: ctx.profile, ...opts });
    } catch (err) {
      throw toConfigError(this.mask, err, what, scrub);
    }
  }

  /** One read of the list, or null when the operation is missing or fails (the other parts still show). */
  private async part<T>(ctx: Ctx, op: string, opts: CallOptions = {}): Promise<T | null> {
    if (!this.can(ctx, op)) return null;
    return this.call<T>(ctx, op, opts).catch(() => null);
  }

  async list(instanceId: string, profile: string): Promise<ProvidersInfo> {
    const ctx = this.ctx(instanceId, profile);
    const [oauth, pool, options] = await Promise.all([
      this.part<z.infer<typeof OAuthProvidersSchema>>(ctx, 'oauthList'),
      this.part<z.infer<typeof PoolSchema>>(ctx, 'poolList'),
      this.part<z.infer<typeof ModelOptionsSchema>>(ctx, 'modelOptions', { query: { include_unconfigured: 'true' } }),
    ]);
    return {
      accounts: oauth === null ? null : oauth.providers.map((p) => ({
        id: p.id,
        name: p.name || p.id,
        flow: p.flow === 'device_code' ? 'device_code' : 'external',
        cliCommand: p.cli_command || null,
        docsUrl: p.docs_url && /^https?:\/\//.test(p.docs_url) ? p.docs_url : null,
        disconnectable: p.disconnectable === true,
        disconnectHint: p.disconnect_hint ? this.mask.text(p.disconnect_hint) : null,
        connected: p.status?.logged_in === true,
        expiresAt: expiresText(p.status?.expires_at),
      })),
      keys: pool === null ? null : pool.providers.flatMap((p) => p.entries
        .filter((e) => (e.auth_type ?? 'api_key') === 'api_key')
        .map((e) => ({ provider: p.provider, id: e.id, label: e.label || e.id, source: e.source || MANUAL, lastStatus: e.last_status ?? null }))),
      keyProviders: (options?.providers ?? [])
        .filter((p) => p.is_user_defined !== true && !p.slug.startsWith('custom:'))
        .map((p) => ({ slug: p.slug, name: p.name || p.slug }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Starts a device-code login. A copy of the config file is kept first, dropped if Hermes refuses. */
  async start(instanceId: string, profile: string, provider: string): Promise<ConnectStart> {
    const ctx = this.ctx(instanceId, profile);
    const copy = await this.config.snapshot(instanceId, profile, 'provider-login').catch(() => null);
    try {
      const r = await this.call<unknown>(ctx, 'oauthStart', { params: { provider } }, 'Fournisseur inconnu');
      const s = OAuthStartSchema.parse(r);
      if (!s.user_code || !s.verification_url) throw new HermesError('schema', 'Hermes n’a pas donné de code de connexion', {});
      this.config.trimHistory(instanceId, profile);
      return { sessionId: s.session_id, userCode: s.user_code, verificationUrl: s.verification_url, pollInterval: s.poll_interval ?? null, expiresIn: s.expires_in ?? null };
    } catch (err) {
      if (copy !== null) this.config.dropSnapshot(instanceId, profile, copy);
      throw err;
    }
  }

  async poll(instanceId: string, profile: string, provider: string, session: string): Promise<ConnectPoll> {
    const ctx = this.ctx(instanceId, profile);
    try {
      const r = await callOp<z.infer<typeof OAuthPollSchema>>(ctx.http, ctx.report, 'config', 'oauthPoll', { profile, params: { provider, session } });
      return { status: r.status, error: r.error_message ? this.mask.text(r.error_message) : null, model: r.model || null };
    } catch (err) {
      // the session is gone: expired, cancelled, or the dashboard restarted
      if (err instanceof HermesError && err.kind === 'http' && err.detail.status === 404) return { status: 'expired', error: null, model: null };
      throw toConfigError(this.mask, err);
    }
  }

  /** Cancels a login; a session already finished or unknown is not an error. */
  async cancel(instanceId: string, profile: string, session: string): Promise<{ ok: true }> {
    const ctx = this.ctx(instanceId, profile);
    await this.call(ctx, 'oauthCancel', { params: { session } }).catch((err: unknown) => {
      if (!(err instanceof NotFoundError)) throw err;
    });
    return { ok: true };
  }

  async disconnect(instanceId: string, profile: string, provider: string): Promise<{ ok: true }> {
    await this.call(this.ctx(instanceId, profile), 'oauthDisconnect', { params: { provider } }, 'Fournisseur inconnu');
    return { ok: true };
  }

  /** Adds an API key; the key is removed from any error detail before masking (Hermes may repeat it). */
  async addKey(instanceId: string, profile: string, k: { provider: string; apiKey: string; label?: string }): Promise<{ count: number | null }> {
    const ctx = this.ctx(instanceId, profile);
    const scrub = (s: string) => s.split(k.apiKey).join('•••');
    const body: Record<string, string> = { provider: k.provider, api_key: k.apiKey };
    if (k.label?.trim()) body.label = k.label.trim();
    const r = PoolAddSchema.safeParse(await this.call<unknown>(ctx, 'poolAdd', { body }, 'Introuvable', scrub));
    return { count: r.success ? r.data.count ?? null : null };
  }

  /**
   * Removes an API key added by hand (`manual`), found by its id: Hermes removes by index, and its removal also
   * cleans the entry's source (a variable, an OAuth file) for good, so other sources are refused. The lock orders
   * Intendia's removals; a change made by the Hermes CLI at the same moment is not detected.
   */
  removeKey(instanceId: string, profile: string, k: { provider: string; id: string }): Promise<{ ok: true }> {
    const ctx = this.ctx(instanceId, profile);
    return this.locked(`${instanceId}:${profile}:${k.provider}`, async () => {
      const pool = await this.call<z.infer<typeof PoolSchema>>(ctx, 'poolList');
      const entry = pool.providers.find((p) => p.provider === k.provider)?.entries.find((e) => e.id === k.id);
      if (!entry) throw new NotFoundError('La clé a déjà été retirée');
      if ((entry.source || MANUAL) !== MANUAL || (entry.auth_type ?? 'api_key') !== 'api_key') {
        throw new ConfigInputError('not_manual', 'Cette clé ne se retire pas ici : elle vient d’une variable ou d’une connexion (onglet Variables ou Abonnements)');
      }
      await this.call(ctx, 'poolRemove', { params: { provider: k.provider, index: String(entry.index) } }, 'Clé introuvable');
      return { ok: true as const };
    });
  }

  private async locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }
}
