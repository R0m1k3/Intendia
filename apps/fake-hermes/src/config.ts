import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { ProviderStore } from './providers.js';

// YAML 1.1 as PyYAML reads it: a float needs a digit (the library alone reads `.` as NaN)
const PY_FLOAT = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*|\.[0-9][0-9_]*)$/;
const PY_FLOAT_EXP = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*|\.[0-9][0-9_]*)[eE][-+][0-9]+$/;
const PY = {
  version: '1.1' as const,
  customTags: ((tags: { tag: string; format?: string; test?: RegExp }[]) => tags.map((t) =>
    t.tag !== 'tag:yaml.org,2002:float' || !t.test || t.test.test('.nan') ? t : { ...t, test: t.format === 'EXP' ? PY_FLOAT_EXP : PY_FLOAT })) as never,
};

/**
 * Configuration routes of the dashboard (phase 6), with state: config file text, env, MCP servers,
 * auxiliary models, gateway restart. One configuration for all profiles, like SkillStore.
 * Unlike Hermes, PUT /api/config/raw keeps the text as sent (Hermes rewrites it; checked on the real one).
 * Words in a model sent to POST /api/model/set: `cher` → confirm_required (without confirm_expensive_model),
 * `refuse` → 400, `notice` → answer with a notice. Auxiliary tasks are written in the file (`auxiliary.<task>`).
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function fixture<T>(dir: string, file: string): T {
  return (JSON.parse(readFileSync(join(dir, 'dash', file), 'utf8')) as { body: T }).body;
}

type Obj = Record<string, unknown>;

/** Models of the `default` profile's OpenRouter provider (the only provider with a key). */
export const OPENROUTER_MODELS = [
  'anthropic/claude-opus-4.6', 'anthropic/claude-sonnet-4.5', 'openai/gpt-5.5', 'google/gemini-3-pro', 'deepseek/deepseek-v3.2', 'qwen/qwen3-coder',
] as const;
/** Hermes `_declared_model_ids`: a string, a list of strings or `{id|name}` objects, or a `{id: meta}` mapping. */
function declaredIds(v: unknown): string[] {
  const raw = typeof v === 'string' ? [v]
    : Array.isArray(v) ? v.map((x) => (isObj(x) ? (typeof x.id === 'string' && x.id.trim() ? x.id : x.name) : x))
    : isObj(v) ? Object.keys(v).filter((k) => !k.startsWith('__')) : [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
}
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null && isObj(out[k])) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Obj, v) : v;
  }
  return out;
}

/** Secrets the tests look for: they must never reach the browser. */
export const FAKE_SECRETS = {
  model: 'sk-test-model-0001',
  mcp: 'sk-test-mcp-0002',
  hook: 'sk-test-hook-0003',
  env: 'sk-test-env-0004',
};

const EXTRA_YAML = `
mcp_servers:
  demo:
    url: https://mcp.example.test/mcp
    headers:
      Authorization: Bearer ${FAKE_SECRETS.mcp}
providers:
  custom:
    api_key: \${CUSTOM_KEY}
notes:
  webhook: https://hooks.slack.com/services/T0/B0/${FAKE_SECRETS.hook}
`;

interface EnvEntry { is_set: boolean; redacted_value: string | null; [k: string]: unknown }
interface Restart { running: boolean; exit_code: number | null; lines: string[]; timer?: ReturnType<typeof setTimeout> }

export class ConfigStore {
  raw: string;
  /** Real values of the env variables set (the fake's .env). */
  readonly envValues = new Map<string, string>([['CUSTOM_KEY', FAKE_SECRETS.env], ['MCP_DEMO_API_KEY', FAKE_SECRETS.mcp]]);
  private readonly envFixture: Record<string, EnvEntry>;
  private readonly defaults: Obj;
  private readonly auxiliary: { tasks: Obj[]; main: Obj };
  private readonly platforms: { platforms: Obj[] };
  private readonly modelOptions: { providers: Obj[] };
  private restart: Restart | null = null;
  /** Set by tests: GET /api/config/raw answers this status. */
  failRaw: number | null = null;
  /** Set by tests: PUT /api/config/raw answers this status without writing. */
  failPutRaw: number | null = null;
  /** Name of the MCP server provided by a plugin (listed, refused by POST). */
  pluginMcpName = 'plugin-srv';
  /** Accounts and credential pool, per profile; an approved Nous login writes the main model, like Hermes. */
  readonly providers = new ProviderStore((model) => {
    const file = this.file();
    this.write({ ...file, model: { ...(isObj(file.model) ? file.model : {}), default: model, provider: 'nous' } });
  });

  constructor(fixturesDir: string, private readonly stepMs: number) {
    const raw = fixture<{ yaml: string }>(fixturesDir, 'GET_api_config_raw.json').yaml;
    // model api_key written in clear, like POST /api/model/set with api_key does
    this.raw = raw.replace(/^model:\n/m, `model:\n  api_key: ${FAKE_SECRETS.model}\n`) + EXTRA_YAML;
    this.envFixture = fixture(fixturesDir, 'GET_api_env.json');
    this.defaults = fixture(fixturesDir, 'GET_api_config_defaults.json');
    this.auxiliary = structuredClone(fixture(fixturesDir, 'GET_api_model_auxiliary.json'));
    this.platforms = structuredClone(fixture(fixturesDir, 'GET_api_messaging_platforms.json'));
    const tg = this.platforms.platforms[0];
    if (tg) tg.error_message = 'bad token 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    this.modelOptions = fixture(fixturesDir, 'GET_api_model_options.json');
  }

  setRaw(text: string): void {
    this.raw = text;
  }

  file(): Obj {
    const v = parseDocument(this.raw, PY).toJS() as unknown;
    return isObj(v) ? v : {};
  }

  private write(obj: Obj): void {
    this.raw = stringify(obj, { version: '1.1' });
  }

  private resolve(v: unknown): unknown {
    if (typeof v === 'string') return v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k: string) => this.envValues.get(k) ?? m);
    if (Array.isArray(v)) return v.map((x) => this.resolve(x));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolve(x)]));
    return v;
  }

  private effective(): Obj {
    const out = this.resolve(deepMerge(this.defaults, this.file())) as Obj;
    if (isObj(out.model)) out.model = String((out.model as Obj).default ?? (out.model as Obj).model ?? '');
    return out;
  }

  private mcp(): Obj[] {
    const servers = (this.file().mcp_servers ?? {}) as Record<string, Obj>;
    const list = Object.entries(servers).map(([name, s]) => ({
      name, transport: s.url ? 'http' : 'stdio', url: s.url ?? null, command: s.command ?? null, args: s.args ?? [],
      env: Object.fromEntries(Object.entries((s.env ?? {}) as Obj).map(([k, v]) => [k, `«redacted:${String(v).slice(0, 4)}...»`])),
      auth: s.headers ? 'header' : 'none', enabled: s.enabled !== false, tools: [], source: 'config', plugin: null,
    }));
    return [...list, { name: this.pluginMcpName, transport: 'http', url: 'https://plugin.example.test/mcp', command: null, args: [], env: {}, auth: 'none', enabled: true, tools: [], source: 'plugin', plugin: 'demo-plugin' }];
  }

  private envList(): Record<string, EnvEntry> {
    const out: Record<string, EnvEntry> = {};
    for (const [k, e] of Object.entries(this.envFixture)) out[k] = { ...e, is_set: this.envValues.has(k) || (e.is_set && !this.deletedEnv.has(k)), redacted_value: null };
    for (const [k, v] of this.envValues) {
      out[k] = { ...(out[k] ?? { description: '', category: 'custom', is_password: true, advanced: false, channel_managed: false, custom: true }), is_set: true, redacted_value: `«redacted:${v.slice(0, 4)}...${v.slice(-4)}»` };
    }
    return out;
  }

  private readonly deletedEnv = new Set<string>();

  /**
   * GET /api/model/options per profile (dashboard `?profile=`, API server `/p/<profile>`): `default` has OpenRouter
   * with a key and 6 models (the recorded entry, made authenticated), any other profile only Anthropic with 2.
   * Both also list DeepSeek and Mistral without a key; a provider with a connected account or a pool API key is
   * authenticated (a row `<slug>-small`/`<slug>-large` is added when the profile has none for it).
   */
  modelOptionsFor(profile: string): { providers: Obj[] } {
    const base: Obj[] = profile !== 'default'
      ? [{ ...(this.modelOptions.providers.find((p) => p.slug === 'anthropic') ?? { slug: 'anthropic', name: 'Anthropic' }), authenticated: true, key_env: 'ANTHROPIC_API_KEY', models: ['claude-opus-4.6', 'claude-haiku-4.5'] }]
      : this.modelOptions.providers.map((p) => p.slug === 'openrouter' ? { ...p, authenticated: true, models: [...OPENROUTER_MODELS] } : p);
    for (const [slug, name] of [['deepseek', 'DeepSeek'], ['mistral', 'Mistral']] as const) {
      if (!base.some((p) => p.slug === slug)) base.push({ slug, name, authenticated: false, key_env: `${slug.toUpperCase()}_API_KEY`, models: [`${slug}-chat`, `${slug}-reasoner`] });
    }
    const authed = this.providers.authenticated(profile);
    const rows = base.map((p) => (authed.has(String(p.slug)) ? { ...p, authenticated: true } : p));
    for (const slug of authed) {
      if (!rows.some((p) => p.slug === slug)) rows.push({ slug, name: slug, authenticated: true, models: [`${slug}-small`, `${slug}-large`] });
    }
    // like Hermes `_lap_builtin_rows`: providers.<slug>.models declared in the file go first, without duplicates
    const declared = isObj(this.file().providers) ? (this.file().providers as Obj) : {};
    return {
      providers: rows.map((p) => {
        const entry = declared[String(p.slug)];
        if (!isObj(entry) || p.is_user_defined) return { ...p, total_models: Array.isArray(p.models) ? p.models.length : p.total_models };
        const seen = new Set<string>();
        const models = [...declaredIds(entry.models), ...((p.models as string[] | undefined) ?? [])]
          .filter((m) => !seen.has(m.toLowerCase()) && Boolean(seen.add(m.toLowerCase())));
        return { ...p, models, total_models: models.length };
      }),
    };
  }

  handle(via: string, method: string, path: string, query: Record<string, string>, body: unknown, profile = 'default'): Response | null {
    if (path === '/api/model/options' && method === 'GET') {
      const model = this.file().model as Obj | undefined;
      const prof = via === 'dash' ? query.profile ?? 'default' : profile;
      return json({ ...this.modelOptionsFor(prof), model: String(model?.default ?? ''), provider: String(model?.provider ?? 'auto') });
    }
    if (via !== 'dash') return null;
    const acc = this.providers.handle(method, path, query.profile ?? 'default', body);
    if (acc) return acc;
    const b = (body ?? {}) as Obj;
    if (path === '/api/config' && method === 'GET') {
      return json(query.include_defaults === 'false' ? this.file() : this.effective());
    }
    if (path === '/api/config' && method === 'PUT') {
      if (!isObj(b.config)) return json({ detail: 'config must be an object' }, 400);
      this.write(deepMerge(this.file(), b.config));
      return json({ ok: true });
    }
    if (path === '/api/config/raw' && method === 'GET') {
      if (this.failRaw) return json({ detail: 'raw config unavailable' }, this.failRaw);
      return json({ yaml: this.raw, path: '/opt/data/config.yaml' });
    }
    if (path === '/api/config/raw' && method === 'PUT') {
      if (this.failPutRaw) return json({ detail: 'raw config write failed' }, this.failPutRaw);
      const text = typeof b.yaml_text === 'string' ? b.yaml_text : '';
      const doc = parseDocument(text, PY);
      if (doc.errors.length) return json({ detail: `Invalid YAML: ${doc.errors[0]!.message}` }, 400);
      if (!isObj(doc.toJS())) return json({ detail: 'YAML must be a mapping' }, 400);
      this.raw = text;
      return json({ ok: true });
    }
    if (path === '/api/env' && method === 'GET') return json(this.envList());
    if (path === '/api/env' && method === 'PUT') {
      const key = String(b.key ?? '');
      const value = String(b.value ?? '');
      if (['PATH', 'LD_PRELOAD', 'HERMES_HOME'].includes(key)) return json({ detail: `Refusing to set ${key}` }, 400);
      if (value.startsWith('«redacted')) return json({ detail: 'Refusing to save a redacted credential preview' }, 400);
      this.envValues.set(key, value);
      this.deletedEnv.delete(key);
      return json({ ok: true, key, config_updates: [] });
    }
    if (path === '/api/env' && method === 'DELETE') {
      const key = String(b.key ?? '');
      const known = this.envValues.has(key) || (this.envFixture[key]?.is_set && !this.deletedEnv.has(key));
      if (!known) return json({ detail: `${key} not found` }, 404);
      this.envValues.delete(key);
      this.deletedEnv.add(key);
      return json({ ok: true, key, removed: true });
    }
    if (path === '/api/mcp/servers' && method === 'GET') return json({ servers: this.mcp() });
    if (path === '/api/mcp/servers' && method === 'POST') {
      const name = String(b.name ?? '');
      const file = this.file();
      const servers = (isObj(file.mcp_servers) ? file.mcp_servers : {}) as Obj;
      if (servers[name] || name === this.pluginMcpName) return json({ detail: `MCP server '${name}' already exists` }, 409);
      if (String(b.url ?? '').includes('refuse')) return json({ detail: `Server '${name}' rejected: suspicious configuration` }, 400);
      const entry: Obj = b.url ? { url: b.url } : { command: b.command, args: b.args ?? [], env: b.env ?? {} };
      if (b.auth === 'header' && typeof b.bearer_token === 'string') {
        const envKey = `MCP_${name.toUpperCase().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '')}_API_KEY`;
        this.envValues.set(envKey, b.bearer_token);
        entry.headers = { Authorization: `Bearer \${${envKey}}` };
      }
      this.write({ ...file, mcp_servers: { ...servers, [name]: entry } });
      return json(this.mcp().find((s) => s.name === name));
    }
    const mcp = /^\/api\/mcp\/servers\/([^/]+)(\/test|\/enabled)?$/.exec(path);
    if (mcp) {
      const name = decodeURIComponent(mcp[1]!);
      const file = this.file();
      const servers = (isObj(file.mcp_servers) ? file.mcp_servers : {}) as Record<string, Obj>;
      if (!servers[name]) return json({ detail: `MCP server '${name}' not found` }, 404);
      if (mcp[2] === '/test' && method === 'POST') {
        if (String(servers[name]!.url ?? '').includes('echec')) return json({ ok: false, error: 'connect failed token=sk-test-err-0005', tools: [] });
        const tool = String(servers[name]!.url ?? '').includes('/mcp/') ? { name: 'share_file', description: 'Share a file' } : { name: 'ping', description: 'Ping' };
        return json({ ok: true, tools: [tool], prompts: [], resources: [] });
      }
      if (mcp[2] === '/enabled' && method === 'PUT') {
        servers[name]!.enabled = Boolean(b.enabled);
        this.write({ ...file, mcp_servers: servers });
        return json({ ok: true, name, enabled: Boolean(b.enabled) });
      }
      if (!mcp[2] && method === 'DELETE') {
        delete servers[name];
        this.write({ ...file, mcp_servers: servers });
        return json({ ok: true });
      }
    }
    if (path === '/api/model/info' && method === 'GET') {
      const model = this.file().model as Obj | string | undefined;
      const m = isObj(model) ? model : { default: model };
      return json({ model: String(m.default ?? ''), provider: String(m.provider ?? 'auto'), auto_context_length: 1000000, config_context_length: 0, effective_context_length: 1000000, capabilities: {} });
    }
    if (path === '/api/model/auxiliary' && method === 'GET') {
      // like Hermes: the tasks live in the file (`auxiliary.<task>.provider/model`), so a raw restore puts them back too
      const aux = this.file().auxiliary;
      const tasks = this.auxiliary.tasks.map((t) => {
        const entry = isObj(aux) ? aux[String(t.task)] : undefined;
        return isObj(entry) ? { ...t, provider: String(entry.provider ?? 'auto'), model: String(entry.model ?? '') } : t;
      });
      return json({ ...this.auxiliary, tasks });
    }
    if (path === '/api/model/set' && method === 'POST') {
      const model = String(b.model ?? '');
      if (model.includes('cher') && !b.confirm_expensive_model) return json({ ok: false, confirm_required: true, confirm_message: 'Modèle coûteux : confirmer ?' });
      if (model.includes('refuse')) return json({ detail: `Model refused: ${model}` }, 400);
      const notice = model.includes('notice') ? 'Contexte réduit, token=sk-test-notice-0007' : undefined;
      if (b.scope === 'auxiliary') {
        const task = String(b.task ?? '');
        const names = this.auxiliary.tasks.map((t) => String(t.task));
        if (task !== '__reset__' && task !== '' && !names.includes(task)) return json({ detail: `Unknown auxiliary task: ${task}` }, 400);
        const file = this.file();
        const aux: Obj = isObj(file.auxiliary) ? { ...file.auxiliary } : {};
        const value = task === '__reset__' ? { provider: 'auto', model: '' } : { provider: b.provider, model };
        for (const name of task === '__reset__' || task === '' ? names : [task]) aux[name] = { ...(isObj(aux[name]) ? aux[name] : {}), ...value };
        this.write({ ...file, auxiliary: aux });
        return json({ ok: true, scope: 'auxiliary', tasks: [task], provider: b.provider, model, notice });
      }
      const file = this.file();
      const current = isObj(file.model) ? file.model : {};
      this.write({ ...file, model: { ...current, default: model, provider: b.provider } });
      return json({ ok: true, scope: 'main', provider: b.provider, model, notice });
    }
    if (path === '/api/messaging/platforms' && method === 'GET') return json(this.platforms);
    if (path === '/api/gateway/restart' && method === 'POST') {
      const prev = this.restart;
      if (prev?.timer) clearTimeout(prev.timer);
      const r: Restart = { running: true, exit_code: null, lines: [...(prev?.lines ?? []), '', '=== gateway-restart started 2026-11-09 12:00:00 ===', ''] };
      this.restart = r;
      let steps = 0;
      const tick = () => {
        steps += 1;
        if (steps < 3) { r.lines.push(`step ${steps}`); r.timer = setTimeout(tick, this.stepMs); return; }
        r.lines.push('Gateway restarted token=sk-test-log-0006', '');
        r.running = false;
        r.exit_code = 0;
      };
      r.timer = setTimeout(tick, this.stepMs);
      return json({ ok: true, pid: 4242, name: 'gateway-restart' });
    }
    if (path === '/api/actions/gateway-restart/status' && method === 'GET') {
      if (!this.restart) return json({ detail: 'Unknown action: gateway-restart' }, 404);
      const r = this.restart;
      return json({ name: 'gateway-restart', running: r.running, exit_code: r.exit_code, pid: 4242, lines: r.lines.slice(-Number(query.lines ?? 200)) });
    }
    return null;
  }
}
