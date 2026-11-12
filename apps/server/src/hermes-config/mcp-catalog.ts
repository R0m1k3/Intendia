import { AdminError } from '../admin-error.js';
import type { CompatService } from '../compat/service.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';
import type { ConfigService, McpFlow } from './service.js';

/** Hermes keeps a dashboard OAuth flow 15 min: a callback after that has nothing to land on. */
export const FLOW_TTL_MS = 15 * 60_000;
export const ENV_VALUE_MAX = 4096;
export const CALLBACK_PARAM_MAX = 2048;
const RELAY_TIMEOUT_MS = 20_000;
export const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface PublicMcpCatalogEntry {
  name: string;
  description: string;
  /** Documentation page (https only). */
  docsUrl: string | null;
  /** oauth | none | env… (Hermes' `auth_type`). */
  auth: string;
  requiredEnv: { name: string; prompt: string; required: boolean }[];
  transport: string | null;
  url: string | null;
  command: string | null;
  args: string[];
  needsInstall: boolean;
  postInstall: string;
  installed: boolean;
  enabled: boolean;
}
export interface PublicMcpFlow {
  id: string;
  /** starting | authorization_required | approved | error */
  status: string;
  authorizationUrl: string | null;
  error: string | null;
  tools: string[];
}
/** `relay`: Intendia's public return route; `hermes`: `dashboard.public_url`; `custom`: a redirect_uri set by hand. */
export type OauthMode = 'relay' | 'hermes' | 'custom';

interface Expected { instanceId: string; name: string; at: number }

const https = (v: string | null | undefined) => (v && /^https:\/\//i.test(v) ? v : null);

/**
 * MCP catalog of Hermes and the OAuth connection of an MCP server (lot 8 E2). Hermes sends the user's browser back to
 * a return URL; when nothing public is configured on the Hermes side, Intendia writes its own public route as
 * `oauth.redirect_uri` and relays the callback to the dashboard, only for a flow it started itself (by `state`).
 */
export class McpCatalogService {
  private readonly expected = new Map<string, Expected>();
  /** Relay flows whose state is not read yet (flow id → instance and server). */
  private readonly relayFlows = new Map<string, Expected>();

  constructor(private readonly config: ConfigService, private readonly compat: CompatService, private readonly publicUrl: string | undefined) {}

  /** Intendia's return URL for a server of an instance, or null without INTENDIA_PUBLIC_URL. */
  callbackUrl(instanceId: string, name: string): string | null {
    return this.publicUrl ? `${this.publicUrl}/x/mcp-oauth/${encodeURIComponent(instanceId)}/${encodeURIComponent(name)}/callback` : null;
  }

  async catalog(instanceId: string, profile: string): Promise<{ entries: PublicMcpCatalogEntry[]; diagnostics: string[]; relay: boolean }> {
    const raw = await this.config.mcpCatalogRaw(instanceId, profile);
    const m = (s: string | null | undefined) => this.config.maskText(s ?? '');
    return {
      entries: raw.entries.map((e) => ({
        name: e.name, description: m(e.description), docsUrl: https(e.source), auth: e.auth_type || 'none',
        requiredEnv: (e.required_env ?? []).map((r) => ({ name: r.name, prompt: m(r.prompt), required: r.required !== false })),
        transport: e.transport ?? null, url: e.url ? m(e.url) : null, command: e.command ?? null, args: (e.args ?? []).map(m),
        needsInstall: e.needs_install === true, postInstall: m(e.post_install).trim(), installed: e.installed === true, enabled: e.enabled === true,
      })),
      diagnostics: (raw.diagnostics ?? []).map((d) => m(`${d.name ?? '?'} : ${d.message ?? d.kind ?? ''}`)),
      relay: Boolean(this.publicUrl),
    };
  }

  /** Installs an entry read again from the catalog; `env` only with the names it declares. Values are not kept. */
  async install(instanceId: string, profile: string, name: string, env: Record<string, string>): Promise<{ version: string | null; background: boolean }> {
    const raw = await this.config.mcpCatalogRaw(instanceId, profile);
    const entry = raw.entries.find((e) => e.name === name);
    if (!entry) throw new NotFoundError(`Absent du catalogue : ${name}`);
    if (entry.installed) throw new AdminError('already_installed', `Déjà installé : ${name}`);
    const declared = entry.required_env ?? [];
    const unknown = Object.keys(env).filter((k) => !declared.some((d) => d.name === k));
    if (unknown.length) throw new ValidationError(`Variables non déclarées par cette entrée : ${unknown.join(', ')}`);
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (v.length > ENV_VALUE_MAX) throw new ValidationError(`${k} : valeur trop longue`);
      if (v.trim()) values[k] = v.trim();
    }
    const missing = declared.filter((d) => d.required !== false && !values[d.name]).map((d) => d.name);
    if (missing.length) throw new ValidationError(`À remplir : ${missing.join(', ')}`);
    const res = await this.config.installMcpCatalog(instanceId, profile, name, values);
    return { version: res.version, background: res.background };
  }

  private toFlow(f: McpFlow): PublicMcpFlow {
    const tools = (f.tools ?? []).map((t) => (typeof t === 'string' ? t : String((t as { name?: unknown })?.name ?? ''))).filter(Boolean);
    return {
      id: f.flow_id, status: f.status, authorizationUrl: f.authorization_url && /^https?:\/\//i.test(f.authorization_url) ? f.authorization_url : null,
      error: f.error ? this.config.maskText(f.error) : null, tools,
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.expected) if (now - v.at > FLOW_TTL_MS) this.expected.delete(k);
    for (const [k, v] of this.relayFlows) if (now - v.at > FLOW_TTL_MS) this.relayFlows.delete(k);
  }

  /** Starts the OAuth connection of an MCP server; the browser opens `authorizationUrl`, then follows the flow. */
  async connect(instanceId: string, profile: string, name: string): Promise<{ flow: PublicMcpFlow; mode: OauthMode }> {
    const s = await this.config.mcpOauthSettings(instanceId, profile, name);
    if (!s) throw new ValidationError('Hermes ne donne pas le fichier de configuration : connexion impossible d’ici');
    if (!s.present) throw new NotFoundError(`Serveur MCP introuvable : ${name}`);
    const ours = this.callbackUrl(instanceId, name);
    let mode: OauthMode;
    if (s.redirectUri && s.redirectUri !== ours) mode = 'custom';
    else if (!s.redirectUri && s.dashboardPublicUrl) mode = 'hermes';
    else if (ours) mode = 'relay';
    else throw new AdminError('no_public_url', 'Définissez INTENDIA_PUBLIC_URL (adresse publique d’Intendia) pour connecter un serveur MCP par OAuth');
    if (mode === 'relay') {
      if (!this.config.canAll(instanceId, ['mcpCallback', 'put'])) throw new AdminError('refused', 'Cette version d’Hermes n’a pas la route de retour OAuth attendue');
      if (s.redirectUri !== ours) await this.config.setMcpRedirect(instanceId, profile, name, ours!);
    }
    const f = await this.config.mcpAuth(instanceId, profile, name);
    if (mode === 'relay') {
      // Hermes may answer `starting` before it has the authorization URL: the state is then read when polling gives it
      this.prune();
      this.relayFlows.set(f.flow_id, { instanceId, name, at: Date.now() });
      await this.expect(instanceId, profile, f);
    }
    return { flow: this.toFlow(f), mode };
  }

  /**
   * Once a relay flow has its authorization URL, its state is expected (15 min from the start of the flow). A URL
   * without state cannot be relayed: the flow is cancelled and refused.
   */
  private async expect(instanceId: string, profile: string, f: McpFlow): Promise<void> {
    const pending = this.relayFlows.get(f.flow_id);
    if (!pending || pending.instanceId !== instanceId || !f.authorization_url) return;
    this.relayFlows.delete(f.flow_id);
    let state: string | null = null;
    try { state = new URL(f.authorization_url).searchParams.get('state'); } catch { state = null; }
    if (!state) {
      await this.config.mcpFlowCancel(instanceId, profile, f.flow_id).catch(() => undefined);
      throw new AdminError('refused', 'Le fournisseur n’a pas donné de paramètre state : Intendia ne peut pas relayer ce retour');
    }
    this.expected.set(state, pending);
  }

  async flow(instanceId: string, profile: string, id: string): Promise<PublicMcpFlow> {
    const f = await this.config.mcpFlow(instanceId, profile, id);
    await this.expect(instanceId, profile, f);
    return this.toFlow(f);
  }

  async cancel(instanceId: string, profile: string, id: string): Promise<{ ok: true }> {
    await this.config.mcpFlowCancel(instanceId, profile, id);
    return { ok: true };
  }

  /** True, and forgotten, when this state belongs to a flow Intendia started for this server less than 15 min ago. */
  takeExpected(state: string, instanceId: string, name: string): boolean {
    this.prune();
    const e = this.expected.get(state);
    if (!e || e.instanceId !== instanceId || e.name !== name) return false;
    this.expected.delete(state);
    return true;
  }

  /**
   * The browser's return from the provider, passed on to the dashboard's public callback without token or cookie.
   * `unknown`: no flow of Intendia waits for it (nothing sent to Hermes).
   */
  async relay(instanceId: string, name: string, q: { code?: string; state?: string; error?: string; iss?: string }): Promise<'ok' | 'failed' | 'unknown'> {
    if (!q.state || !this.takeExpected(q.state, instanceId, name)) return 'unknown';
    try {
      const res = await this.compat.http(instanceId).request('dash', 'GET', `/api/mcp/oauth/callback/${encodeURIComponent(name)}`, {
        query: { code: q.code, state: q.state, error: q.error, iss: q.iss }, anonymous: true, timeoutMs: RELAY_TIMEOUT_MS,
      });
      await res.body?.cancel().catch(() => undefined);
      return res.ok ? 'ok' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
