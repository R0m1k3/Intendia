import { createHash } from 'node:crypto';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { CompatService } from '../compat/service.js';
import { ActionStatusSchema, lastRunLines } from '../connectors/actions.js';
import {
  AuxiliarySchema, ConfigSchemaSchema, EnvListSchema, GATEWAY_RESTART_ACTION, McpServersSchema,
  McpTestSchema, ModelInfoSchema, ModelOptionsSchema, ModelSetSchema, PlatformsSchema, RawConfigSchema, mcpTokenEnv,
} from '../connectors/config/index.js';
import { callOp, HermesError, hermesDetail, type CallOptions } from '../connectors/runtime.js';
import { decrypt, encrypt } from '../crypto.js';
import type { Db } from '../db/index.js';
import { configVersions } from '../db/schema.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError } from '../workspaces/service.js';
import { Masker, PLACEHOLDER_START, parse, SecretError } from './mask.js';
import { checkValue, flatten, MODEL_PATHS, unflatten, validateDoc, type Fields } from './schema.js';

/**
 * Settings of a Hermes instance (phase 6): config form and YAML editor, history, models, env, MCP servers,
 * platforms, gateway restart. Every write that can change the Hermes config file goes through `write()`:
 * lock, reread, version check, history copy, Hermes call, new version.
 */

export const HISTORY_KEEP = 10;
const HISTORY_PURPOSE = 'config-history-v1';
const STATUS_LINES = 200;
const TEST_MS = 40_000;

export type WriteSource = 'form' | 'yaml' | 'restore' | 'model' | 'env' | 'mcp';
const CHECKED: ReadonlySet<WriteSource> = new Set(['form', 'yaml', 'restore', 'model']);

export class ConfigInputError extends Error {
  constructor(readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ConfigInputError';
  }
}

export class ConfigConflictError extends Error {
  constructor(readonly code: 'config_changed' | 'config_unavailable' | 'hermes_conflict', message: string) {
    super(message);
    this.name = 'ConfigConflictError';
  }
}

export class ConfirmRequiredError extends Error {
  readonly code = 'confirm_required';
  constructor(readonly prompt: string) {
    super('Confirmation demandée par Hermes');
    this.name = 'ConfirmRequiredError';
  }
}

export interface PublicConfig {
  values: Record<string, unknown>;
  schema: Fields;
  categories: string[];
  version: string | null;
}
export interface PublicVersion { id: number; createdAt: number; source: string; readable: boolean }
export interface PublicModels {
  main: { provider: string; model: string; contextLength: number | null };
  providers: { slug: string; name: string; authenticated: boolean; keyEnv: string | null; models: string[]; warning: string | null }[];
  auxiliary: { task: string; label: string | null; provider: string; model: string }[];
  version: string | null;
}
export interface PublicEnv {
  key: string; isSet: boolean; description: string | null; category: string | null; isPassword: boolean;
  advanced: boolean; channelManaged: boolean; provider: string | null; custom: boolean;
}
export interface PublicMcp {
  name: string; transport: string | null; url: string | null; command: string | null; args: string[];
  env: { key: string; isSet: boolean }[]; auth: string | null; enabled: boolean; tools: string[]; source: string | null; plugin: string | null;
}
export interface PublicPlatform {
  id: string; name: string; enabled: boolean; configured: boolean; state: string | null; errorMessage: string | null;
  env: { key: string; isSet: boolean; required: boolean }[];
}
export interface PublicRestart { running: boolean; exitCode: number | null; lines: string[]; truncated: boolean }

export interface ModelChange { scope: 'main' | 'auxiliary'; provider: string; model: string; task?: string; confirm?: boolean; version: string }
export interface McpCreate { name: string; url?: string; token?: string; command?: string; args?: string[]; env?: Record<string, string> }

type Ctx = { http: ReturnType<CompatService['http']>; report: ReturnType<CompatService['get']>; instanceId: string; profile: string };

export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function containsEnvRef(v: unknown): boolean {
  if (typeof v === 'string') return v.includes('${');
  if (Array.isArray(v)) return v.some(containsEnvRef);
  if (isPlainObject(v)) return Object.values(v).some(containsEnvRef);
  return false;
}

function getPath(obj: unknown, path: string): unknown {
  let node = obj;
  for (const k of path.split('.')) {
    if (!isPlainObject(node) || !(k in node)) return undefined;
    node = node[k];
  }
  return node;
}

export class ConfigService {
  private readonly mask: Masker;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    private readonly db: Db,
    private readonly secret: string,
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

  /** Hermes call with error translation (texts masked). */
  private async call<T = unknown>(ctx: Ctx, op: string, opts: CallOptions = {}, what = 'Introuvable'): Promise<T> {
    try {
      return await callOp<T>(ctx.http, ctx.report, 'config', op, { profile: ctx.profile, ...opts });
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') {
        const detail = this.mask.text(hermesDetail(err));
        const status = err.detail.status;
        if (status === 404) throw new NotFoundError(`${what} : ${detail}`);
        if (status === 400 || status === 422) throw new ConfigInputError('hermes_refused', `Requête refusée par Hermes : ${detail}`);
        if (status === 409) throw new ConfigConflictError('hermes_conflict', `Conflit signalé par Hermes : ${detail}`);
        throw new HermesError('http', `Hermes a répondu ${status} : ${detail}`, err.detail);
      }
      throw err;
    }
  }

  /** Text of the config file, or null when Hermes cannot give it (no route, error status). */
  private async readRaw(ctx: Ctx): Promise<string | null> {
    if (!this.can(ctx, 'raw')) return null;
    try {
      const raw = await callOp<unknown>(ctx.http, ctx.report, 'config', 'raw', { profile: ctx.profile });
      return RawConfigSchema.parse(raw).yaml;
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') return null;
      throw err;
    }
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

  /** The single path of every write that can change the config file. */
  private write(ctx: Ctx, source: WriteSource, expected: string | null, fn: (current: string | null) => Promise<void>): Promise<{ version: string | null }> {
    return this.locked(`${ctx.instanceId}:${ctx.profile}`, async () => {
      const current = await this.readRaw(ctx);
      if (current === null) {
        if (CHECKED.has(source)) {
          throw new ConfigConflictError('config_unavailable', 'Écriture impossible : Hermes ne donne pas le fichier de configuration');
        }
        await fn(null);
        return { version: null };
      }
      if (CHECKED.has(source) && expected !== null && versionOf(current) !== expected) {
        throw new ConfigConflictError('config_changed', "La configuration a changé dans Hermes depuis l'affichage");
      }
      this.copy(ctx, source, current);
      await fn(current);
      const after = await this.readRaw(ctx).catch(() => null);
      return { version: after === null ? null : versionOf(after) };
    });
  }

  // ---------------------------------------------------------------- history

  private rows(ctx: Ctx) {
    return this.db.select().from(configVersions)
      .where(and(eq(configVersions.instanceId, ctx.instanceId), eq(configVersions.profile, ctx.profile)))
      .orderBy(desc(configVersions.id)).all();
  }

  private copy(ctx: Ctx, source: WriteSource, text: string): void {
    const hash = versionOf(text);
    const latest = this.rows(ctx)[0];
    if (latest) {
      try {
        if ((JSON.parse(latest.configJson) as { hash?: string }).hash === hash) return;
      } catch { /* unreadable row: copy again */ }
    }
    this.db.insert(configVersions).values({
      instanceId: ctx.instanceId, profile: ctx.profile, createdAt: Date.now(),
      configJson: JSON.stringify({ format: 'yaml', source, hash, enc: encrypt(this.secret, text, HISTORY_PURPOSE) }),
    }).run();
    const keep = this.rows(ctx).slice(0, HISTORY_KEEP).map((r) => r.id);
    this.db.delete(configVersions).where(and(
      eq(configVersions.instanceId, ctx.instanceId), eq(configVersions.profile, ctx.profile), notInArray(configVersions.id, keep),
    )).run();
  }

  private openRow(row: { configJson: string }): { source: string; text: string | null } {
    try {
      const v = JSON.parse(row.configJson) as { source?: string; enc?: string };
      try {
        return { source: v.source ?? 'form', text: v.enc ? decrypt(this.secret, v.enc, HISTORY_PURPOSE) : null };
      } catch {
        return { source: v.source ?? 'form', text: null };
      }
    } catch {
      return { source: 'form', text: null };
    }
  }

  versions(instanceId: string, profile: string): PublicVersion[] {
    const ctx = this.ctx(instanceId, profile);
    return this.rows(ctx).map((r) => {
      const o = this.openRow(r);
      return { id: r.id, createdAt: r.createdAt, source: o.source, readable: o.text !== null };
    });
  }

  private versionText(ctx: Ctx, id: number): string {
    const row = this.rows(ctx).find((r) => r.id === id);
    const text = row ? this.openRow(row).text : null;
    if (text === null) throw new NotFoundError(`Copie introuvable : ${id}`);
    return text;
  }

  version(instanceId: string, profile: string, id: number): { yaml: string } {
    return { yaml: this.mask.yaml(this.versionText(this.ctx(instanceId, profile), id)) };
  }

  async restore(instanceId: string, profile: string, id: number, version: string): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    const text = this.versionText(ctx, id);
    return this.write(ctx, 'restore', version, async () => {
      await this.call(ctx, 'putRaw', { body: { yaml_text: text } });
    });
  }

  // ---------------------------------------------------------------- form

  async form(instanceId: string, profile: string): Promise<PublicConfig> {
    const ctx = this.ctx(instanceId, profile);
    const [effective, file, schema, raw] = await Promise.all([
      this.call<Record<string, unknown>>(ctx, 'get'),
      this.call<Record<string, unknown>>(ctx, 'get', { query: { include_defaults: 'false' } }),
      this.call<unknown>(ctx, 'schema').then((s) => ConfigSchemaSchema.parse(s)),
      this.readRaw(ctx),
    ]);
    const fields = schema.fields;
    const values = flatten(effective, fields);
    // a `${VAR}` reference is shown as written, not with the value Hermes put in its place
    for (const path of Object.keys(values)) {
      const written = getPath(file, path);
      if (containsEnvRef(written)) values[path] = written;
    }
    for (const p of MODEL_PATHS) delete values[p];
    const masked = Object.fromEntries(Object.entries(values).map(([p, v]) => [p, this.mask.config(v, p.split('.'))]));
    const order = schema.category_order ?? [];
    const all = new Set(Object.values(fields).map((f) => f.category ?? 'general'));
    const categories = [...order.filter((c) => all.has(c)), ...[...all].filter((c) => !order.includes(c)).sort()];
    return { values: masked, schema: fields, categories, version: raw === null ? null : versionOf(raw) };
  }

  async saveForm(instanceId: string, profile: string, changes: Record<string, unknown>, version: string): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    const { fields } = ConfigSchemaSchema.parse(await this.call<unknown>(ctx, 'schema'));
    for (const [path, value] of Object.entries(changes)) {
      if (MODEL_PATHS.has(path)) throw new ConfigInputError('model_field', `${path} se change dans l'onglet Modèles`, { path });
      const field = fields[path];
      if (!field) throw new ConfigInputError('unknown_field', `Réglage inconnu : ${path}`, { path });
      const strings = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
      if (strings.some((s) => s.includes(PLACEHOLDER_START))) {
        throw new ConfigInputError('secret_placeholder', `${path} : valeur masquée`, { path });
      }
      const bad = checkValue(field, value);
      if (bad) throw new ConfigInputError('invalid_field', `${path} : ${bad}`, { paths: [path] });
    }
    return this.write(ctx, 'form', version, async () => {
      await this.call(ctx, 'put', { body: { config: unflatten(changes) } });
    });
  }

  // ---------------------------------------------------------------- YAML

  async raw(instanceId: string, profile: string): Promise<{ yaml: string; version: string }> {
    const ctx = this.ctx(instanceId, profile);
    const text = await this.readRaw(ctx);
    if (text === null) throw new ConfigConflictError('config_unavailable', 'Hermes ne donne pas le fichier de configuration');
    return { yaml: this.mask.yaml(text), version: versionOf(text) };
  }

  async saveRaw(instanceId: string, profile: string, draft: string, version: string): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    const { fields } = ConfigSchemaSchema.parse(await this.call<unknown>(ctx, 'schema'));
    return this.write(ctx, 'yaml', version, async (current) => {
      let text: string;
      try {
        text = this.mask.restore(draft, current ?? '');
      } catch (err) {
        if (err instanceof SecretError) throw new ConfigInputError(err.code, err.message, err.extra);
        throw err;
      }
      const bad = validateDoc(parse(text).toJS(), fields);
      if (bad.length) throw new ConfigInputError('invalid_field', `Valeurs invalides : ${bad.join(', ')}`, { paths: bad });
      await this.call(ctx, 'putRaw', { body: { yaml_text: text } });
    });
  }

  // ---------------------------------------------------------------- models

  async models(instanceId: string, profile: string): Promise<PublicModels> {
    const ctx = this.ctx(instanceId, profile);
    const [info, options, aux] = await Promise.all([
      this.call<unknown>(ctx, 'modelInfo').then((v) => ModelInfoSchema.parse(v)),
      this.call<unknown>(ctx, 'modelOptions', { query: { include_unconfigured: 'true' } }).then((v) => ModelOptionsSchema.parse(v)),
      this.call<unknown>(ctx, 'auxiliary').then((v) => AuxiliarySchema.parse(v)),
    ]);
    // reading the options may write discovered models into the file: version after it
    const raw = await this.readRaw(ctx);
    return {
      main: { provider: info.provider, model: info.model, contextLength: info.effective_context_length ?? null },
      providers: options.providers.map((p) => ({
        slug: p.slug, name: p.name, authenticated: p.authenticated ?? false, keyEnv: p.key_env || null,
        models: p.models ?? [], warning: p.warning ? this.mask.text(p.warning) : null,
      })),
      auxiliary: aux.tasks.map((t) => ({ task: t.task, label: t.label ?? null, provider: t.provider ?? 'auto', model: t.model ?? '' })),
      version: raw === null ? null : versionOf(raw),
    };
  }

  async setModel(instanceId: string, profile: string, change: ModelChange): Promise<{ version: string | null; notice?: string }> {
    const ctx = this.ctx(instanceId, profile);
    let notice: string | undefined;
    const res = await this.write(ctx, 'model', change.version, async () => {
      // never api_key (Hermes writes it in clear) nor base_url (custom endpoints are not handled here)
      const body: Record<string, unknown> = { scope: change.scope, provider: change.provider, model: change.model };
      if (change.scope === 'auxiliary') body.task = change.task;
      if (change.confirm) body.confirm_expensive_model = true;
      const out = ModelSetSchema.parse(await this.call<unknown>(ctx, 'setModel', { body }));
      if (out.ok === false && out.confirm_required) throw new ConfirmRequiredError(this.mask.text(out.confirm_message ?? 'Confirmer ce modèle ?'));
      if (out.notice) notice = this.mask.text(out.notice);
    });
    return notice ? { ...res, notice } : res;
  }

  // ---------------------------------------------------------------- env

  async env(instanceId: string, profile: string): Promise<PublicEnv[]> {
    const ctx = this.ctx(instanceId, profile);
    const list = EnvListSchema.parse(await this.call<unknown>(ctx, 'env'));
    // field by field: redacted_value (first and last characters) never leaves the server
    return Object.entries(list).map(([key, e]) => ({
      key, isSet: e.is_set, description: e.description ?? null, category: e.category ?? null, isPassword: e.is_password ?? false,
      advanced: e.advanced ?? false, channelManaged: e.channel_managed ?? false, provider: e.provider ?? null, custom: e.custom ?? false,
    })).sort((a, b) => a.key.localeCompare(b.key));
  }

  async setEnv(instanceId: string, profile: string, key: string, value: string): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    return this.write(ctx, 'env', null, async () => {
      await this.call(ctx, 'putEnv', { body: { key, value } });
    });
  }

  async deleteEnv(instanceId: string, profile: string, key: string): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    return this.write(ctx, 'env', null, async () => {
      await this.call(ctx, 'deleteEnv', { body: { key } }, 'Variable introuvable');
    });
  }

  // ---------------------------------------------------------------- MCP

  async mcp(instanceId: string, profile: string): Promise<PublicMcp[]> {
    const ctx = this.ctx(instanceId, profile);
    const { servers } = McpServersSchema.parse(await this.call<unknown>(ctx, 'mcpServers'));
    return servers.map((s) => ({
      name: s.name, transport: s.transport ?? null, url: s.url ? this.mask.url(s.url) : null, command: s.command ?? null,
      args: (s.args ?? []).map((a) => this.mask.text(a)),
      env: Object.entries(s.env ?? {}).map(([key, v]) => ({ key, isSet: v !== null && v !== '' })),
      auth: s.auth ?? null, enabled: s.enabled ?? true,
      tools: Array.isArray(s.tools) ? s.tools.map((t) => (typeof t === 'string' ? t : String((t as { name?: unknown }).name ?? ''))).filter(Boolean) : [],
      source: s.source ?? null, plugin: s.plugin || null,
    }));
  }

  async addMcp(instanceId: string, profile: string, input: McpCreate): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    const body: Record<string, unknown> = { name: input.name };
    if (input.url) {
      body.url = input.url;
      if (input.token) { body.auth = 'header'; body.bearer_token = input.token; }
    } else {
      body.command = input.command;
      body.args = input.args ?? [];
      body.env = input.env ?? {};
    }
    return this.write(ctx, 'mcp', null, async () => {
      await this.call(ctx, 'addMcp', { body });
    });
  }

  async testMcp(instanceId: string, profile: string, name: string): Promise<{ ok: boolean; tools: string[]; error?: string }> {
    const ctx = this.ctx(instanceId, profile);
    const out = McpTestSchema.parse(await this.call<unknown>(ctx, 'testMcp', { params: { name }, timeoutMs: TEST_MS }, 'Serveur MCP introuvable'));
    return { ok: out.ok, tools: (out.tools ?? []).map((t) => t.name), ...(out.error ? { error: this.mask.text(out.error) } : {}) };
  }

  async enableMcp(instanceId: string, profile: string, name: string, enabled: boolean): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    return this.write(ctx, 'mcp', null, async () => {
      await this.call(ctx, 'enableMcp', { params: { name }, body: { enabled } }, 'Serveur MCP introuvable');
    });
  }

  async removeMcp(instanceId: string, profile: string, name: string): Promise<{ version: string | null; tokenLeft?: string }> {
    const ctx = this.ctx(instanceId, profile);
    let tokenLeft: string | undefined;
    const res = await this.write(ctx, 'mcp', null, async () => {
      await this.call(ctx, 'removeMcp', { params: { name } }, 'Serveur MCP introuvable');
      // Hermes leaves the bearer token in its env file
      const key = mcpTokenEnv(name);
      try {
        await this.call(ctx, 'deleteEnv', { body: { key } });
      } catch (err) {
        if (!(err instanceof NotFoundError)) tokenLeft = key;
      }
    });
    return tokenLeft ? { ...res, tokenLeft } : res;
  }

  // ---------------------------------------------------------------- platforms, gateway

  async platforms(instanceId: string, profile: string): Promise<PublicPlatform[]> {
    const ctx = this.ctx(instanceId, profile);
    const { platforms } = PlatformsSchema.parse(await this.call<unknown>(ctx, 'platforms'));
    return platforms.map((p) => ({
      id: p.id, name: p.name, enabled: p.enabled ?? false, configured: p.configured ?? false, state: p.state ?? null,
      errorMessage: p.error_message ? this.mask.text(p.error_message) : null,
      env: (p.env_vars ?? []).map((e) => ({ key: e.key, isSet: e.is_set ?? false, required: e.required ?? false })),
    }));
  }

  async restartGateway(instanceId: string, profile: string): Promise<{ ok: true }> {
    const ctx = this.ctx(instanceId, profile);
    await this.call(ctx, 'restartGateway');
    return { ok: true };
  }

  async restartStatus(instanceId: string, profile: string): Promise<PublicRestart> {
    const ctx = this.ctx(instanceId, profile);
    try {
      const raw = await this.call<unknown>(ctx, 'actionStatus', { params: { name: GATEWAY_RESTART_ACTION }, query: { lines: STATUS_LINES } });
      const s = ActionStatusSchema.parse(raw);
      const last = lastRunLines(GATEWAY_RESTART_ACTION, s.lines);
      return { running: s.running, exitCode: s.exit_code, lines: last.lines.map((l) => this.mask.text(l)), truncated: last.truncated };
    } catch (err) {
      // no restart yet: Hermes does not know the action
      if (err instanceof NotFoundError) return { running: false, exitCode: null, lines: [], truncated: false };
      throw err;
    }
  }
}
