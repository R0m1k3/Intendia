import { randomUUID } from 'node:crypto';
import { AdminError } from '../admin-error.js';
import type { CompatService } from '../compat/service.js';
import { CatalogSchema, HubSchema, type HermesCatalogEntry } from '../connectors/plugins/index.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import { hostPaths, Masker } from '../hermes-config/mask.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';
import { msg } from '../i18n/index.js';

/** Plugin names in a URL: Hermes refuses `..` and backslashes; Intendia keeps to plain names. */
export const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Hermes answers an install only when it is over (git clone + pip install). */
export const INSTALL_TIMEOUT_MS = 600_000;
const JOB_TTL_MS = 3_600_000;
/** Some catalog descriptions are a whole README (29 kB on 0.23): the list keeps the start. */
export const DESCRIPTION_MAX = 600;
const clip = (s: string) => (s.length > DESCRIPTION_MAX ? `${s.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : s);

export interface PublicPlugin {
  name: string;
  version: string | null;
  description: string;
  /** bundled | user | git | pip… */
  source: string | null;
  /** enabled | inactive | disabled… (Hermes' words). */
  status: string | null;
  canRemove: boolean;
  authRequired: boolean;
  /** Command to run on the server to sign the plugin in, masked. */
  authCommand: string | null;
  hidden: boolean;
  removedReason: string | null;
}
export interface PublicCatalogEntry {
  name: string;
  title: string;
  description: string;
  maintainer: string | null;
  /** official | verified | community. */
  tier: string | null;
  category: string | null;
  version: string | null;
  shaShort: string;
  docsUrl: string | null;
  requiresHermes: string | null;
  platforms: string[];
  tools: string[];
  hooks: string[];
  middleware: string[];
  requiresEnv: string[];
  knownIssues: string[];
  installed: boolean;
  updateAvailable: boolean;
}
export interface InstallResult {
  /** installed, or `consent`: Hermes wants a decision Intendia does not take (nothing changed). */
  state: 'installed' | 'consent';
  plugin: string | null;
  enabled: boolean;
  restartRequired: boolean;
  gatewayReloaded: boolean;
  missingEnv: string[];
  warnings: string[];
  knownIssues: string[];
  message: string | null;
}
export interface PluginJob {
  id: string;
  name: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  result: InstallResult | null;
  error: string | null;
}
interface Job extends PluginJob { instanceId: string }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const https = (v: string | null | undefined) => (v && /^https:\/\//i.test(v) ? v : null);

/**
 * Agent plugins of an instance (lot 8 E). Installs come from Hermes' curated catalog only: the browser sends a
 * name, the server reads the catalog again and sends that entry's repository and pinned commit. One install at a time
 * per instance, as an Intendia background job (jobs kept in memory for an hour).
 */
export class PluginService {
  private readonly mask: Masker;
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore, secret: string) {
    this.mask = new Masker(secret);
  }

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(msg('Instance inconnue : {id}', { id: instanceId }));
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId) };
  }

  private clean(s: string): string {
    return hostPaths(this.mask.text(s));
  }

  private async call<T>(instanceId: string, op: string, opts: Parameters<typeof callOp>[4] = {}): Promise<T> {
    const { http, report } = this.ctx(instanceId);
    try {
      return await callOp<T>(http, report, 'plugins', op, opts);
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') {
        const detail = this.clean(hermesDetail(err));
        if (err.detail.status === 404) throw new NotFoundError(msg('Plugin introuvable : {name}', { name: detail }));
        if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(msg('Refusé par Hermes : {detail}', { detail }));
        throw new HermesError('http', msg('Hermes : {detail}', { detail }), err.detail);
      }
      throw err;
    }
  }

  private checkName(name: string): void {
    if (!PLUGIN_NAME_RE.test(name)) throw new ValidationError(msg('Nom de plugin invalide'));
  }

  async list(instanceId: string): Promise<{ plugins: PublicPlugin[] }> {
    const hub = HubSchema.parse(await this.call<unknown>(instanceId, 'installed'));
    return {
      plugins: hub.plugins.map((p) => ({
        name: p.name, version: p.version || null, description: this.clean(p.description ?? ''), source: p.source ?? null,
        status: p.runtime_status ?? null, canRemove: p.can_remove === true, authRequired: p.auth_required === true,
        authCommand: p.auth_command ? this.clean(p.auth_command) : null, hidden: p.user_hidden === true,
        removedReason: p.removed_reason ? this.clean(p.removed_reason) : null,
      })),
    };
  }

  private async rawCatalog(instanceId: string) {
    const cat = CatalogSchema.parse(await this.call<unknown>(instanceId, 'catalog'));
    const removed = new Set((cat.removed ?? []).map((r) => r.name));
    return { cat, entries: cat.entries.filter((e) => !removed.has(e.name)) };
  }

  private toEntry(e: HermesCatalogEntry): PublicCatalogEntry {
    const caps = e.capabilities ?? {};
    return {
      name: e.name, title: e.title || e.name, description: clip(e.description ?? ''), maintainer: e.maintainer || null,
      tier: e.tier || null, category: e.category || null, version: e.version || null, shaShort: e.sha_short || e.sha.slice(0, 7),
      docsUrl: https(e.docs_url), requiresHermes: e.requires_hermes || null, platforms: strings(e.platforms),
      tools: strings(caps.provides_tools), hooks: strings(caps.provides_hooks), middleware: strings(caps.provides_middleware),
      requiresEnv: strings(caps.requires_env), knownIssues: strings(e.known_issues),
      installed: e.installed === true, updateAvailable: e.update_available === true,
    };
  }

  /** The curated catalog without its withdrawn entries; those are listed apart with Hermes' reason. */
  async catalog(instanceId: string): Promise<{ entries: PublicCatalogEntry[]; removed: { name: string; reason: string | null }[]; generatedAt: string | null }> {
    const { cat, entries } = await this.rawCatalog(instanceId);
    return {
      entries: entries.map((e) => this.toEntry(e)),
      removed: (cat.removed ?? []).map((r) => ({ name: r.name, reason: r.reason ? this.clean(r.reason) : null })),
      generatedAt: cat.generated_at ?? null,
    };
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.finishedAt && now - j.finishedAt > JOB_TTL_MS) this.jobs.delete(id);
  }

  private running(instanceId: string): Job | undefined {
    return [...this.jobs.values()].find((j) => j.instanceId === instanceId && j.state === 'running');
  }

  private toJob(j: Job): PluginJob {
    const { instanceId: _i, ...pub } = j;
    return pub;
  }

  /** Starts the install of a catalog entry; the answer is the job to follow. */
  async install(instanceId: string, name: string): Promise<{ job: PluginJob }> {
    this.checkName(name);
    this.prune();
    if (this.running(instanceId)) throw new AdminError('busy', msg('Une installation de plugin est déjà en cours sur cette instance'));
    const { entries } = await this.rawCatalog(instanceId);
    const entry = entries.find((e) => e.name === name);
    if (!entry) throw new NotFoundError(msg('Absent du catalogue : {name}', { name }));
    if (!/^https:\/\//i.test(entry.repo) || !/^[0-9a-f]{40}$/i.test(entry.sha)) {
      throw new ValidationError(msg('Entrée du catalogue sans dépôt ni commit vérifiable'));
    }
    const installed = (await this.list(instanceId)).plugins.some((p) => p.name === name);
    if (entry.installed || installed) throw new AdminError('already_installed', msg('Déjà installé : {name}', { name }));
    // checked again after the awaits: two clicks at once must not start two installs
    if (this.running(instanceId)) throw new AdminError('busy', msg('Une installation de plugin est déjà en cours sur cette instance'));
    const job: Job = { id: randomUUID(), instanceId, name, state: 'running', startedAt: Date.now(), finishedAt: null, result: null, error: null };
    this.jobs.set(job.id, job);
    void this.run(job, { identifier: entry.repo, ref: entry.sha, catalog_name: entry.name, enable: true, force: false });
    return { job: this.toJob(job) };
  }

  private async run(job: Job, body: Record<string, unknown>): Promise<void> {
    try {
      const r = (await this.call<Record<string, unknown>>(job.instanceId, 'install', { body, timeoutMs: INSTALL_TIMEOUT_MS })) ?? {};
      job.result = {
        state: r.consent_required ? 'consent' : 'installed',
        plugin: typeof r.plugin_name === 'string' ? r.plugin_name : typeof r.name === 'string' ? r.name : null,
        enabled: r.enabled === true, restartRequired: r.restart_required === true, gatewayReloaded: r.gateway_reloaded === true,
        missingEnv: strings(r.missing_env), warnings: strings(r.warnings).map((w) => this.clean(w)),
        knownIssues: strings(r.known_issues).map((w) => this.clean(w)),
        message: typeof r.error === 'string' ? this.clean(r.error) : null,
      };
      job.state = 'done';
    } catch (err) {
      const timeout = err instanceof Error && /timeout|abort/i.test(`${err.message} ${String((err as { cause?: unknown }).cause ?? '')}`);
      job.error = timeout
        ? msg('Hermes n’a pas répondu en 10 minutes : l’installation continue peut-être de son côté, rechargez la liste plus tard')
        : this.clean(err instanceof Error ? err.message : String(err));
      job.state = 'failed';
    } finally {
      job.finishedAt = Date.now();
    }
  }

  job(instanceId: string, id: string): PluginJob {
    this.ctx(instanceId);
    this.prune();
    const j = this.jobs.get(id);
    if (!j || j.instanceId !== instanceId) throw new NotFoundError(msg('Tâche inconnue (Intendia a peut-être redémarré)'));
    return this.toJob(j);
  }

  /** The install running on this instance, to find it again after a page reload. */
  current(instanceId: string): { job: PluginJob | null } {
    this.ctx(instanceId);
    const j = this.running(instanceId);
    return { job: j ? this.toJob(j) : null };
  }

  async setEnabled(instanceId: string, name: string, enabled: boolean): Promise<{ ok: true }> {
    this.checkName(name);
    await this.call(instanceId, enabled ? 'enable' : 'disable', { params: { name } });
    return { ok: true };
  }

  async remove(instanceId: string, name: string): Promise<{ ok: true }> {
    this.checkName(name);
    const p = (await this.list(instanceId)).plugins.find((x) => x.name === name);
    if (!p) throw new NotFoundError(msg('Plugin introuvable : {name}', { name }));
    if (!p.canRemove) throw new AdminError('protected', msg('Ce plugin est fourni avec Hermes : désactivez-le plutôt'));
    await this.call(instanceId, 'remove', { params: { name } });
    return { ok: true };
  }
}
