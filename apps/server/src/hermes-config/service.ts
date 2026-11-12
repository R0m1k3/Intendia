import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { CompatService } from '../compat/service.js';
import { GatewayService } from './gateway.js';
import {
  AuxiliarySchema, ConfigSchemaSchema, EnvListSchema, McpServersSchema, McpCatalogSchema, McpFlowSchema,
  McpTestSchema, ModelInfoSchema, ModelOptionsSchema, ModelSetSchema, PlatformsSchema, RawConfigSchema, mcpTokenEnv,
  configModule,
} from '../connectors/config/index.js';
import { callOp, HermesError, hermesDetail, type CallOptions } from '../connectors/runtime.js';
import { decrypt, encrypt } from '../crypto.js';
import type { Db } from '../db/index.js';
import { configVersions } from '../db/schema.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError } from '../workspaces/service.js';
import { checkEndpoint, HERMES_ALIASES, keyEnvFor, readCustomProviders, slugFor, withoutProvider, type PublicCustomProvider } from './custom-providers.js';
import { declaredModels, editableShape, type Declared } from './declared.js';
import { KNOWN_MIN, Masker, PLACEHOLDER_START, parse, SecretError } from './mask.js';
import { checkValue, flatten, MODEL_PATHS, unflatten, validateDoc, type Fields } from './schema.js';

/**
 * Settings of a Hermes instance (phase 6): config form and YAML editor, history, models, env, MCP servers,
 * platforms, gateway restart. Every write that can change the Hermes config file goes through `write()`:
 * lock, reread, version check, history copy, Hermes call, new version.
 */

export const HISTORY_KEEP = 10;
const HISTORY_PURPOSE = 'config-history-v1';
const TEST_MS = 40_000;

export type McpCatalog = z.infer<typeof McpCatalogSchema>;
export type McpFlow = z.infer<typeof McpFlowSchema>;
export type WriteSource = 'form' | 'yaml' | 'restore' | 'model' | 'env' | 'mcp' | 'orchestration' | 'provider-models' | 'provider-login' | 'custom-providers';
const CHECKED: ReadonlySet<WriteSource> = new Set(['form', 'yaml', 'restore', 'model']);

export class ConfigInputError extends Error {
  constructor(readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ConfigInputError';
  }
}

export class ConfigConflictError extends Error {
  constructor(
    readonly code: 'config_changed' | 'config_unavailable' | 'config_unreadable' | 'hermes_conflict' | 'mcp_plugin' | 'mcp_other' | 'mcp_unavailable'
      | 'exists' | 'in_use' | 'raw_unavailable' | 'api_key_present',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigConflictError';
  }
}

/** Variables Hermes reads for Anthropic, in its order: the API key first, then the subscription tokens. */
export const ANTHROPIC_KEY_VAR = 'ANTHROPIC_API_KEY';
export const ANTHROPIC_TOKEN_VARS = ['ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;

/** A `claude setup-token` token (`sk-ant-oat…`), trimmed; refuses a console API key with its own message. */
export function checkSetupToken(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('sk-ant-api')) throw new ConfigInputError('api_key_given', 'C’est une clé d’API : ajoutez-la dans Clés d’API');
  if (t.length < 20 || t.length > 4096 || /\s/.test(t) || !t.startsWith('sk-ant-oat')) {
    throw new ConfigInputError('invalid_token', 'Ce n’est pas un jeton de claude setup-token (sk-ant-oat…)');
  }
  return t;
}

export class ConfirmRequiredError extends Error {
  readonly code = 'confirm_required';
  constructor(readonly prompt: string, readonly task?: string) {
    super('Confirmation demandée par Hermes');
    this.name = 'ConfirmRequiredError';
  }
}

/** Some tasks of a group write may be written and could not be put back: the history copy stays. */
export class PartialWriteError extends Error {
  readonly code = 'partial_write';
  constructor(message = "Écriture peut-être partielle : vérifiez les valeurs ou restaurez la version d'avant dans l'onglet Historique") {
    super(message);
    this.name = 'PartialWriteError';
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
  providers: {
    slug: string; name: string; authenticated: boolean; keyEnv: string | null; models: string[]; warning: string | null;
    /** Models declared in `providers.<slug>.models` (what the chat offers; none = the whole catalogue). */
    declared: string[];
    /** The declaration can be changed from Intendia (plain list, built-in provider). */
    editable: boolean;
  }[];
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
export interface AuxChange { task: string; provider: string; model: string }
export type McpRawEntry =
  | { status: 'unreadable' } | { status: 'absent' }
  | { status: 'present'; source: 'config' | 'plugin'; url: string | null; enabled: boolean; authorization: string | null };
export interface McpCreate { name: string; url?: string; token?: string; command?: string; args?: string[]; env?: Record<string, string> }

type Ctx = { http: ReturnType<CompatService['http']>; report: ReturnType<CompatService['get']>; instanceId: string; profile: string };

/** Hermes or Intendia said no before writing (a timeout or a 5xx may have written, so the copy stays). */
/** Thrown inside `write()` when the change would not modify the file: nothing written, no history copy. */
class NoChange extends Error {}

/** Conflicts found by Intendia or Hermes before anything was written. */
const REFUSALS: ReadonlySet<ConfigConflictError['code']> = new Set(['hermes_conflict', 'exists', 'in_use', 'raw_unavailable', 'config_unavailable', 'api_key_present']);

function refused(err: unknown): boolean {
  return err instanceof NoChange || err instanceof ConfigInputError || err instanceof ConfirmRequiredError || err instanceof NotFoundError
    || (err instanceof ConfigConflictError && REFUSALS.has(err.code));
}

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

/**
 * Intendia error for a failed Hermes call (returned, the caller throws it): an HTTP answer becomes a refusal (400,
 * 422), a conflict (409), a not found (404) or a Hermes error, its detail masked. `scrub` cleans the detail first
 * (e.g. removes a key the request carried, which Hermes may repeat). Other errors are returned as they are.
 */
export function toConfigError(mask: Masker, err: unknown, what = 'Introuvable', scrub: (s: string) => string = (s) => s): unknown {
  if (!(err instanceof HermesError && err.kind === 'http')) return err;
  const detail = mask.text(scrub(hermesDetail(err)));
  const status = err.detail.status;
  if (status === 404) return new NotFoundError(`${what} : ${detail}`);
  if (status === 400 || status === 422) return new ConfigInputError('hermes_refused', `Requête refusée par Hermes : ${detail}`);
  if (status === 409) return new ConfigConflictError('hermes_conflict', `Conflit signalé par Hermes : ${detail}`);
  return new HermesError('http', `Hermes a répondu ${status} : ${detail}`, err.detail);
}

const KNOWN_TTL_MS = 60_000;

export class ConfigService {
  private readonly mask: Masker;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly knownCache = new Map<string, { at: number; values: string[] }>();

  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    private readonly db: Db,
    private readonly secret: string,
  ) {
    this.mask = new Masker(secret);
    this.gateway = new GatewayService(compat, store, secret);
  }

  /** Start, stop, restart of the gateways. */
  readonly gateway: GatewayService;

  private ctx(instanceId: string, profile: string): Ctx {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId), instanceId, profile };
  }

  private can(ctx: Ctx, op: string): boolean {
    return Boolean(ctx.report?.modules.find((m) => m.id === 'config')?.ops[op]?.ok);
  }

  /** Every listed operation of the config module passed the compatibility check. */
  canAll(instanceId: string, ops: readonly string[]): boolean {
    const ctx = this.ctx(instanceId, 'default');
    return ops.every((op) => this.can(ctx, op));
  }

  /** Hermes call with error translation (texts masked). */
  private async call<T = unknown>(ctx: Ctx, op: string, opts: CallOptions = {}, what = 'Introuvable', scrub?: (s: string) => string): Promise<T> {
    try {
      return await callOp<T>(ctx.http, ctx.report, 'config', op, { profile: ctx.profile, ...opts });
    } catch (err) {
      throw toConfigError(this.mask, err, what, scrub);
    } finally {
      // a write may add or change a secret: the logs must not wait for the cache to expire to mask it
      if (configModule.ops[op]?.kind === 'write') this.knownCache.delete(`${ctx.instanceId}:${ctx.profile}`);
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

  /**
   * Secret values of the profile's config file (what the masking rules hide), to mask their exact copies in texts
   * Hermes does not redact (logs). Cached 60 s; [] when the raw config cannot be read.
   */
  async knownSecrets(instanceId: string, profile: string): Promise<string[]> {
    const key = `${instanceId}:${profile}`;
    const hit = this.knownCache.get(key);
    if (hit && Date.now() - hit.at < KNOWN_TTL_MS) return hit.values;
    let values: string[] = [];
    try {
      const raw = await this.readRaw(this.ctx(instanceId, profile));
      if (raw) values = [...new Set(this.mask.sources(raw).values())].filter((v) => v.length >= KNOWN_MIN);
    } catch {
      values = [];
    }
    this.knownCache.set(key, { at: Date.now(), values });
    return values;
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
      const copied = this.copy(ctx, source, current);
      try {
        await fn(current);
      } catch (err) {
        // refused before anything was written: the copy would describe a write that never happened
        if (copied !== null && refused(err)) this.db.delete(configVersions).where(eq(configVersions.id, copied)).run();
        throw err;
      }
      this.trim(ctx);
      const after = await this.readRaw(ctx).catch(() => null);
      return { version: after === null ? null : versionOf(after) };
    });
  }

  // ---------------------------------------------------------------- history

  /**
   * Copy of the current file before Hermes may change it by itself (an approved provider login can write the main
   * model). Id of the copy, null when nothing was copied (no file, or same text as the latest copy). The history is
   * trimmed only after the action succeeded (`trimHistory`), and the copy dropped if it failed (`dropSnapshot`),
   * in the same order as `write()`.
   */
  snapshot(instanceId: string, profile: string, source: WriteSource): Promise<number | null> {
    const ctx = this.ctx(instanceId, profile);
    return this.locked(`${ctx.instanceId}:${ctx.profile}`, async () => {
      const current = await this.readRaw(ctx);
      return current === null ? null : this.copy(ctx, source, current);
    });
  }

  dropSnapshot(instanceId: string, profile: string, id: number): void {
    this.db.delete(configVersions).where(and(
      eq(configVersions.id, id), eq(configVersions.instanceId, instanceId), eq(configVersions.profile, profile),
    )).run();
  }

  trimHistory(instanceId: string, profile: string): void {
    this.trim(this.ctx(instanceId, profile));
  }

  private rows(ctx: Ctx) {
    return this.db.select().from(configVersions)
      .where(and(eq(configVersions.instanceId, ctx.instanceId), eq(configVersions.profile, ctx.profile)))
      .orderBy(desc(configVersions.id)).all();
  }

  /** Copy of the file before a write (id of the new row, null when the latest copy is the same text). */
  private copy(ctx: Ctx, source: WriteSource, text: string): number | null {
    const hash = versionOf(text);
    const latest = this.rows(ctx)[0];
    if (latest) {
      try {
        if ((JSON.parse(latest.configJson) as { hash?: string }).hash === hash) return null;
      } catch { /* unreadable row: copy again */ }
    }
    const row = this.db.insert(configVersions).values({
      instanceId: ctx.instanceId, profile: ctx.profile, createdAt: Date.now(),
      configJson: JSON.stringify({ format: 'yaml', source, hash, enc: encrypt(this.secret, text, HISTORY_PURPOSE) }),
    }).returning({ id: configVersions.id }).get();
    return row?.id ?? null;
  }

  private trim(ctx: Ctx): void {
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

  /**
   * Personalities of the profile's config, merged as Hermes does: `personalities`, then
   * `agent.personalities`, which wins on a same name. A value is a text or {system_prompt, tone, style}.
   */
  async personalities(instanceId: string, profile: string): Promise<Record<string, unknown>> {
    const cfg = await this.call<Record<string, unknown>>(this.ctx(instanceId, profile), 'get');
    const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
    return { ...obj(cfg.personalities), ...obj(obj(cfg.agent).personalities) };
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
      // `null` = back to Hermes' default, only for the fields Hermes types `string` because their default is None
      // (agent.run_budget_seconds, agent.max_turns, kanban.max_in_progress…): « no limit »
      const bad = checkValue(field, value, { allowNull: field.type === 'string' });
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
    const declared = raw === null ? null : declaredModels(raw);
    return {
      main: { provider: info.provider, model: info.model, contextLength: info.effective_context_length ?? null },
      providers: options.providers.map((p) => {
        const d = declared?.get(p.slug);
        return {
          slug: p.slug, name: p.name, authenticated: p.authenticated ?? false, keyEnv: p.key_env || null,
          models: p.models ?? [], warning: p.warning ? this.mask.text(p.warning) : null,
          declared: d?.ids ?? [],
          editable: declared !== null && p.is_user_defined !== true && !p.slug.startsWith('custom:')
            && !(d && (d.custom || !editableShape(d.shape))),
        };
      }),
      auxiliary: aux.tasks.map((t) => ({ task: t.task, label: t.label ?? null, provider: t.provider ?? 'auto', model: t.model ?? '' })),
      version: raw === null ? null : versionOf(raw),
    };
  }

  /** Declared models of every provider entry of the file, null when Hermes does not give the file. */
  async declaredFor(instanceId: string, profile: string): Promise<Map<string, Declared> | null> {
    const raw = await this.readRaw(this.ctx(instanceId, profile));
    return raw === null ? null : declaredModels(raw);
  }

  /**
   * Adds or removes one model in `providers.<provider>.models`. Applied to the current text under the lock, without a
   * version check (the change is targeted and idempotent); the list is sent whole by PUT /api/config, whose merge
   * replaces lists.
   */
  async changeProviderModels(instanceId: string, profile: string, provider: string, change: { add: string } | { remove: string }): Promise<{ declared: string[] }> {
    const ctx = this.ctx(instanceId, profile);
    let next: string[] = [];
    try {
      await this.write(ctx, 'provider-models', null, async (current) => {
        if (current === null) throw new ConfigConflictError('config_unreadable', 'Écriture impossible : Hermes ne donne pas le fichier de configuration');
        const d = declaredModels(current).get(provider);
        if (d && (d.custom || !editableShape(d.shape))) {
          throw new ConfigInputError('not_editable', 'Les modèles de ce fournisseur se modifient dans l\'onglet YAML', { provider });
        }
        const ids = d?.ids ?? [];
        if ('add' in change) {
          const has = ids.some((m) => m.toLowerCase() === change.add.toLowerCase());
          next = has ? ids : [...ids, change.add];
        } else {
          next = ids.filter((m) => m !== change.remove);
        }
        if (next.length === ids.length) throw new NoChange();
        await this.call(ctx, 'put', { body: { config: { providers: { [provider]: { models: next } } } } });
      });
    } catch (err) {
      if (!(err instanceof NoChange)) throw err;
    }
    return { declared: next };
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

  /**
   * Several auxiliary tasks in one write, all or nothing: one version check, one history copy, then one
   * `model/set` per task. When Hermes refuses task k > 0 (nothing written for it), the text read before is
   * put back by `putRaw` and the refusal goes on (the copy is dropped as for any refusal). An uncertain
   * error after the first task, or no way to put the file back, gives `PartialWriteError` (copy kept).
   */
  async setAuxiliary(instanceId: string, profile: string, input: { version: string; changes: AuxChange[]; confirm?: boolean }): Promise<{ version: string | null; notice?: string }> {
    const ctx = this.ctx(instanceId, profile);
    const notices: string[] = [];
    const res = await this.write(ctx, 'model', input.version, async (original) => {
      for (const [k, change] of input.changes.entries()) {
        try {
          const body: Record<string, unknown> = { scope: 'auxiliary', task: change.task, provider: change.provider, model: change.model };
          if (input.confirm) body.confirm_expensive_model = true;
          const out = ModelSetSchema.parse(await this.call<unknown>(ctx, 'setModel', { body }));
          if (out.ok === false && out.confirm_required) {
            throw new ConfirmRequiredError(this.mask.text(out.confirm_message ?? 'Confirmer ce modèle ?'), change.task);
          }
          if (out.notice) {
            const n = this.mask.text(out.notice);
            if (!notices.includes(n)) notices.push(n);
          }
        } catch (err) {
          if (k === 0) throw err;
          if (!refused(err) || original === null || !this.can(ctx, 'putRaw')) throw new PartialWriteError();
          try {
            await this.call(ctx, 'putRaw', { body: { yaml_text: original } });
          } catch {
            throw new PartialWriteError();
          }
          throw err;
        }
      }
    });
    return notices.length ? { ...res, notice: notices.join(' ') } : res;
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

  // ---------------------------------------------------------------- kanban orchestration

  /**
   * `PUT /api/plugins/kanban/orchestration` rewrites the config file of the dashboard's launch profile
   * (`active_profile`): it goes through `write` for that profile, so the file is copied first.
   */
  async setOrchestration(instanceId: string, body: Record<string, unknown>): Promise<{ version: string | null; profile: string }> {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    const http = this.compat.http(instanceId);
    const report = this.compat.get(instanceId);
    const kanban = async <T>(op: string, opts: CallOptions = {}): Promise<T> => {
      try {
        return await callOp<T>(http, report, 'kanban', op, opts);
      } catch (err) {
        throw toConfigError(this.mask, err, 'Orchestration');
      }
    };
    const current = await kanban<{ active_profile?: unknown }>('orchestration');
    const profile = typeof current.active_profile === 'string' && current.active_profile ? current.active_profile : 'default';
    const ctx = this.ctx(instanceId, profile);
    const res = await this.write(ctx, 'orchestration', null, async () => {
      await kanban('setOrchestration', { body });
    });
    return { ...res, profile };
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

  /**
   * One MCP entry as written in the config file (the list of Hermes gives no headers): `unreadable` when
   * the list or the file cannot be read. `authorization` must never leave the server.
   */
  async mcpRawEntry(instanceId: string, profile: string, name: string): Promise<McpRawEntry> {
    const ctx = this.ctx(instanceId, profile);
    let listed: { source?: string | null; url?: string | null; enabled?: boolean } | undefined;
    try {
      listed = McpServersSchema.parse(await this.call<unknown>(ctx, 'mcpServers')).servers.find((s) => s.name === name);
    } catch {
      return { status: 'unreadable' };
    }
    const raw = await this.readRaw(ctx).catch(() => null);
    if (raw === null) return { status: 'unreadable' };
    const servers = (parse(raw).toJS() as { mcp_servers?: unknown } | null)?.mcp_servers;
    const entry = servers && typeof servers === 'object' ? (servers as Record<string, unknown>)[name] : undefined;
    if (!listed && (entry === undefined || entry === null)) return { status: 'absent' };
    const e = (entry && typeof entry === 'object' ? entry : {}) as { url?: unknown; enabled?: unknown; headers?: unknown };
    const headers = (e.headers && typeof e.headers === 'object' ? e.headers : {}) as Record<string, unknown>;
    const authKey = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
    return {
      status: 'present',
      source: listed?.source === 'plugin' ? 'plugin' : 'config',
      url: typeof e.url === 'string' ? e.url : (listed?.url ?? null),
      enabled: e.enabled !== false && listed?.enabled !== false,
      authorization: authKey && typeof headers[authKey] === 'string' ? headers[authKey] : null,
    };
  }

  /**
   * Puts a bearer-token URL entry in place of `name`, in one write: the entry is removed (its env
   * variable is kept: Hermes rewrites it on add), then added. When Hermes refuses the add after the
   * removal, the text read before is put back by `putRaw`; an uncertain error, or no way to put the
   * file back, gives `PartialWriteError`.
   */
  async replaceMcp(instanceId: string, profile: string, input: { name: string; url: string; token: string; exists: boolean }): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    return this.write(ctx, 'mcp', null, async (original) => {
      if (original === null) throw new ConfigConflictError('config_unavailable', 'Écriture impossible : Hermes ne donne pas le fichier de configuration');
      if (input.exists) await this.call(ctx, 'removeMcp', { params: { name: input.name } }, 'Serveur MCP introuvable');
      try {
        await this.call(ctx, 'addMcp', { body: { name: input.name, url: input.url, auth: 'header', bearer_token: input.token } });
      } catch (err) {
        if (!input.exists) throw err;
        if (!refused(err) || !this.can(ctx, 'putRaw')) throw new PartialWriteError();
        try {
          await this.call(ctx, 'putRaw', { body: { yaml_text: original } });
        } catch {
          throw new PartialWriteError();
        }
        throw err;
      }
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

  // ---------------------------------------------------------------- MCP catalog and OAuth (lot 8 E2)

  /** Catalog of approved MCP servers, as Hermes gives it (masking is done by `McpCatalogService`). */
  async mcpCatalogRaw(instanceId: string, profile: string): Promise<McpCatalog> {
    const ctx = this.ctx(instanceId, profile);
    return McpCatalogSchema.parse(await this.call<unknown>(ctx, 'mcpCatalog'));
  }

  /**
   * Installs a catalog entry; `env` (declared names only, checked by the caller) goes to Hermes, which writes the
   * secret ones into the profile's .env. The values never appear in an error (scrubbed before masking).
   */
  async installMcpCatalog(instanceId: string, profile: string, name: string, env: Record<string, string>): Promise<{ version: string | null; background: boolean; action: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    const values = Object.values(env).filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
    const scrub = (t: string) => values.reduce((acc, v) => acc.split(v).join('…'), t);
    let out: { background?: unknown; action?: unknown } = {};
    const res = await this.write(ctx, 'mcp', null, async () => {
      out = (await this.call<{ background?: unknown; action?: unknown }>(ctx, 'mcpInstall', { body: { name, env, enable: true } }, 'Absent du catalogue', scrub)) ?? {};
    });
    return { ...res, background: out.background === true, action: typeof out.action === 'string' ? out.action : null };
  }

  /**
   * What decides the OAuth return URL of a server (Hermes: `mcp_servers.<name>.oauth.redirect_uri`, else
   * `dashboard.public_url`, else the address Intendia used to reach the dashboard). null when the file is unreadable.
   */
  async mcpOauthSettings(instanceId: string, profile: string, name: string): Promise<{ present: boolean; redirectUri: string | null; dashboardPublicUrl: string | null } | null> {
    const raw = await this.readRaw(this.ctx(instanceId, profile));
    if (raw === null) return null;
    const doc = (parse(raw).toJS() ?? {}) as { mcp_servers?: unknown; dashboard?: unknown };
    const servers = doc.mcp_servers && typeof doc.mcp_servers === 'object' ? doc.mcp_servers as Record<string, unknown> : {};
    const entry = servers[name] && typeof servers[name] === 'object' ? servers[name] as { oauth?: unknown } : null;
    const oauth = entry?.oauth && typeof entry.oauth === 'object' ? entry.oauth as { redirect_uri?: unknown } : {};
    const dash = doc.dashboard && typeof doc.dashboard === 'object' ? doc.dashboard as { public_url?: unknown } : {};
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { present: entry !== null, redirectUri: str(oauth.redirect_uri), dashboardPublicUrl: str(dash.public_url) };
  }

  /** Writes `mcp_servers.<name>.oauth.redirect_uri` (merged by Hermes into the existing entry). */
  async setMcpRedirect(instanceId: string, profile: string, name: string, uri: string): Promise<{ version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    return this.write(ctx, 'mcp', null, async () => {
      await this.call(ctx, 'put', { body: { config: { mcp_servers: { [name]: { oauth: { redirect_uri: uri } } } } } });
    });
  }

  async mcpAuth(instanceId: string, profile: string, name: string): Promise<McpFlow> {
    const ctx = this.ctx(instanceId, profile);
    // Hermes waits up to 30 s for the authorization URL
    return McpFlowSchema.parse(await this.call<unknown>(ctx, 'mcpAuth', { params: { name }, timeoutMs: 45_000 }, 'Serveur MCP introuvable'));
  }

  async mcpFlow(instanceId: string, profile: string, id: string): Promise<McpFlow> {
    const ctx = this.ctx(instanceId, profile);
    return McpFlowSchema.parse(await this.call<unknown>(ctx, 'mcpFlow', { params: { flow_id: id } }, 'Connexion expirée'));
  }

  async mcpFlowCancel(instanceId: string, profile: string, id: string): Promise<void> {
    const ctx = this.ctx(instanceId, profile);
    await this.call(ctx, 'mcpFlowCancel', { params: { flow_id: id } }, 'Connexion expirée');
  }

  /** The masked text of a Hermes message (MCP catalog texts). */
  maskText(text: string): string {
    return this.mask.text(text);
  }

  // ---------------------------------------------------------------- Anthropic subscription token

  /**
   * Saves a `claude setup-token` token where Hermes's own CLI puts it (`ANTHROPIC_TOKEN`). Hermes prefers
   * `ANTHROPIC_API_KEY`: when it is set, refused (409 `api_key_present`) unless `replaceApiKey`, then deleted after the
   * token is written (CLI order). The token never appears in an error (scrubbed before masking).
   */
  async setAnthropicToken(
    instanceId: string, profile: string, raw: string, replaceApiKey: boolean,
  ): Promise<{ version: string | null; restartNeeded: boolean }> {
    const token = checkSetupToken(raw);
    const ctx = this.ctx(instanceId, profile);
    const scrub = (s: string) => s.split(token).join('•••');
    let restartNeeded = false;
    const res = await this.write(ctx, 'env', null, async () => {
      const env = EnvListSchema.parse(await this.call<unknown>(ctx, 'env', {}, 'Introuvable', scrub));
      const keySet = env[ANTHROPIC_KEY_VAR]?.is_set === true;
      if (keySet && !replaceApiKey) {
        throw new ConfigConflictError('api_key_present', `Une clé d'API Anthropic (${ANTHROPIC_KEY_VAR}) est définie et Hermes la préfère au jeton`);
      }
      await this.call(ctx, 'putEnv', { body: { key: ANTHROPIC_TOKEN_VARS[0], value: token } }, 'Introuvable', scrub);
      if (!keySet) return;
      try {
        await this.call(ctx, 'deleteEnv', { body: { key: ANTHROPIC_KEY_VAR } }, 'Variable introuvable', scrub);
      } catch (err) {
        if (!(err instanceof NotFoundError)) {
          throw new PartialWriteError(`Jeton enregistré, mais la clé ${ANTHROPIC_KEY_VAR} n'a pas pu être supprimée et passe encore avant lui : retirez-la dans Clés d'API`);
        }
      }
      // the running gateway keeps a deleted variable until it restarts
      restartNeeded = true;
    });
    return { ...res, restartNeeded };
  }

  /** Deletes the token variables (`ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`) that are set; never the API key. */
  async removeAnthropicToken(instanceId: string, profile: string): Promise<{ version: string | null; left: string[]; restartNeeded: true }> {
    const ctx = this.ctx(instanceId, profile);
    const left: string[] = [];
    const res = await this.write(ctx, 'env', null, async () => {
      const env = EnvListSchema.parse(await this.call<unknown>(ctx, 'env'));
      const set = ANTHROPIC_TOKEN_VARS.filter((k) => env[k]?.is_set === true);
      if (set.length === 0) throw new NotFoundError('Aucun jeton d’abonnement Anthropic enregistré');
      for (const key of set) {
        try {
          await this.call(ctx, 'deleteEnv', { body: { key } }, 'Variable introuvable');
        } catch {
          left.push(key);
        }
      }
    });
    return { ...res, left, restartNeeded: true };
  }

  // ---------------------------------------------------------------- custom endpoints

  /** Custom endpoints of the file (v12 and old shapes), with whether their key variable is set. Never a key value. */
  async customProviders(instanceId: string, profile: string): Promise<{ endpoints: PublicCustomProvider[]; writable: boolean }> {
    const ctx = this.ctx(instanceId, profile);
    const raw = await this.readRaw(ctx);
    if (raw === null) return { endpoints: [], writable: false };
    const read = readCustomProviders(raw);
    const env = read.some((e) => e.key?.kind === 'env') ? await this.env(instanceId, profile).catch(() => null) : null;
    const isSet = new Map((env ?? []).map((v) => [v.key, v.isSet]));
    return {
      // an address may carry a password or a key in its query: masked like the YAML tab
      endpoints: read.map((e) => ({
        ...e,
        baseUrl: this.mask.url(e.baseUrl),
        name: e.name === e.baseUrl ? this.mask.url(e.name) : e.name,
        key: e.key?.kind === 'env' ? { ...e.key, set: isSet.get(e.key.name) ?? false } : e.key,
      })),
      writable: this.can(ctx, 'put') && this.can(ctx, 'putRaw'),
    };
  }

  /**
   * Adds `providers.<slug>`; its key goes to the variable INTENDIA_<SLUG>_API_KEY, never into the file. One `write`
   * (lock + one history copy), raw calls inside. `reserved`: slugs of Hermes's built-in providers (from the caller).
   */
  async addCustomProvider(
    instanceId: string, profile: string, input: { name: string; baseUrl: string; apiKey?: string; model?: string }, reserved: ReadonlySet<string>,
  ): Promise<{ slug: string; version: string | null }> {
    const ctx = this.ctx(instanceId, profile);
    const e = checkEndpoint(input);
    const apiKey = input.apiKey?.trim() || null;
    const res = await this.write(ctx, 'custom-providers', null, async (current) => {
      if (current === null) throw new ConfigConflictError('config_unavailable', 'Écriture impossible : Hermes ne donne pas le fichier de configuration');
      const taken = new Set([...reserved, ...HERMES_ALIASES].map((x) => x.toLowerCase()));
      const doc = parse(current).toJS() as Record<string, unknown> | null;
      const providers = doc && typeof doc.providers === 'object' && doc.providers ? Object.keys(doc.providers) : [];
      for (const k of providers) taken.add(k.toLowerCase());
      for (const old of readCustomProviders(current).filter((x) => x.legacy)) taken.add(slugFor(old.name));
      if (taken.has(e.slug)) throw new ConfigConflictError('exists', `Nom déjà pris (${e.slug}) : choisissez-en un autre`);
      const keyEnv = apiKey ? keyEnvFor(e.slug) : null;
      if (keyEnv) {
        const env = EnvListSchema.parse(await this.call<unknown>(ctx, 'env'));
        if (env[keyEnv]?.is_set) throw new ConfigConflictError('exists', `La variable ${keyEnv} existe déjà : choisissez un autre nom`);
        await this.call(ctx, 'putEnv', { body: { key: keyEnv, value: apiKey } });
      }
      const entry: Record<string, unknown> = { name: e.name, api: e.baseUrl };
      if (keyEnv) entry.key_env = keyEnv;
      if (e.model) {
        entry.default_model = e.model;
        entry.models = [e.model];
      }
      try {
        await this.call(ctx, 'put', { body: { config: { providers: { [e.slug]: entry } } } });
      } catch (err) {
        // refused: nothing written, the variable goes too; uncertain (timeout, 5xx): the file may hold the entry
        if (!keyEnv) throw err;
        if (!refused(err)) throw new PartialWriteError();
        try {
          await this.call(ctx, 'deleteEnv', { body: { key: keyEnv } });
        } catch {
          throw new PartialWriteError(`Endpoint refusé par Hermes, mais la variable ${keyEnv} n'a pas pu être retirée : retirez-la dans l'onglet Variables`);
        }
        throw err;
      }
    });
    return { slug: e.slug, ...res };
  }

  /**
   * Removes `providers.<slug>` by a raw write (Hermes 0.23: `PUT /api/config` with `null` answers ok and keeps the
   * entry), then its INTENDIA_… key variable when no other entry uses it. Never another variable.
   */
  async removeCustomProvider(instanceId: string, profile: string, slug: string): Promise<{ version: string | null; keyLeft?: string }> {
    const ctx = this.ctx(instanceId, profile);
    let keyLeft: string | undefined;
    const res = await this.write(ctx, 'custom-providers', null, async (current) => {
      if (current === null) throw new ConfigConflictError('config_unavailable', 'Écriture impossible : Hermes ne donne pas le fichier de configuration');
      const all = readCustomProviders(current);
      const target = all.find((x) => x.slug === slug);
      if (!target) throw new NotFoundError(`Endpoint introuvable : ${slug}`);
      const doc = parse(current).toJS() as Record<string, unknown> | null;
      const model = doc && typeof doc.model === 'object' && doc.model ? (doc.model as Record<string, unknown>) : {};
      if (model.provider === slug || model.provider === `custom:${slug}`) {
        throw new ConfigConflictError('in_use', 'Cet endpoint sert le modèle principal : changez de modèle (onglet Modèles) avant de le supprimer');
      }
      if (!this.can(ctx, 'putRaw')) throw new ConfigConflictError('raw_unavailable', 'Suppression impossible sur cette instance : retirez-le dans l’onglet YAML');
      await this.call(ctx, 'putRaw', { body: { yaml_text: withoutProvider(current, slug) } });
      const keyEnv = target.key?.kind === 'env' ? target.key.name : null;
      const shared = keyEnv && all.some((x) => x !== target && x.key?.kind === 'env' && x.key.name === keyEnv);
      if (keyEnv && keyEnv.startsWith('INTENDIA_') && !shared) {
        try {
          await this.call(ctx, 'deleteEnv', { body: { key: keyEnv } });
        } catch (err) {
          if (!(err instanceof NotFoundError)) keyLeft = keyEnv;
        }
      }
    });
    return keyLeft ? { ...res, keyLeft } : res;
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
    return this.gateway.run(instanceId, profile, 'restart');
  }

  async restartStatus(instanceId: string, profile: string): Promise<PublicRestart> {
    return this.gateway.status(instanceId, profile, 'restart');
  }
}
