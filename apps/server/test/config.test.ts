import { describe, expect, it } from 'vitest';
import { configVersions } from '../src/db/schema.js';
import { encrypt } from '../src/crypto.js';
import { parse } from '../src/hermes-config/mask.js';
import { HISTORY_KEEP } from '../src/hermes-config/service.js';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/config';
type T = Awaited<ReturnType<typeof testApp>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dashCalls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);
const LEAKS = /sk-test|AAAAAAAAAA|redacted/;

async function version(t: T, profile = 'default'): Promise<string> {
  return (await t.request('GET', `${BASE}/raw?profile=${profile}`)).json.version;
}

describe('config: no secret reaches the browser', () => {
  it('masks every read', async () => {
    const t = await testApp();
    await t.request('POST', `${BASE}/mcp`, { name: 'broken', url: 'https://echec.example.test/mcp' });
    const reads = await Promise.all([
      t.request('GET', BASE), t.request('GET', `${BASE}/raw`), t.request('GET', `${BASE}/env`), t.request('GET', `${BASE}/mcp`),
      t.request('GET', `${BASE}/platforms`), t.request('GET', `${BASE}/models`), t.request('POST', `${BASE}/mcp/broken/test`),
    ]);
    for (const r of reads) {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.json)).not.toMatch(LEAKS);
    }
    const [form, raw, env, mcp, platforms, , test] = reads.map((r) => r.json);
    expect(form.values['display.compact']).toBe(false);
    expect(form.values.model).toBeUndefined();
    expect(raw.yaml).toMatch(/api_key: "«secret:[0-9a-f]{8}»"/);
    expect(raw.yaml).toContain('${CUSTOM_KEY}');
    expect(env.env.find((e: { key: string }) => e.key === 'CUSTOM_KEY')).toMatchObject({ isSet: true });
    expect(Object.keys(env.env[0]).sort()).toEqual(['advanced', 'category', 'channelManaged', 'custom', 'description', 'isPassword', 'isSet', 'key', 'provider']);
    expect(mcp.servers.find((s: { name: string }) => s.name === 'plugin-srv').plugin).toBe('demo-plugin');
    expect(platforms.platforms[0].errorMessage).toContain('bad token «secret:');
    expect(test.ok).toBe(false);
    expect(test.error).toContain('«secret:');

    await t.request('POST', `${BASE}/gateway/restart`);
    await sleep(40);
    expect(JSON.stringify((await t.request('GET', `${BASE}/gateway/restart`)).json)).not.toMatch(LEAKS);
  });

  it('shows a ${VAR} reference instead of the value Hermes substituted', async () => {
    const t = await testApp();
    t.fake.config.setRaw(`${t.fake.config.raw}\ntts:\n  provider: \${CUSTOM_KEY}\n`);
    const form = (await t.request('GET', BASE)).json;
    expect(form.values['tts.provider']).toBe('${CUSTOM_KEY}');
  });
});

describe('config: form', () => {
  it('sends only the changed paths, nested, and returns the new version', async () => {
    const t = await testApp();
    const v = (await t.request('GET', BASE)).json.version;
    const res = await t.request('PUT', BASE, { changes: { 'display.compact': true, 'runtime.nofile_soft_limit': 42 }, version: v });
    expect(res.status).toBe(200);
    expect(res.json.version).toMatch(/^[0-9a-f]{16}$/);
    expect(res.json.version).not.toBe(v);
    expect(dashCalls(t, 'PUT', '/api/config').at(-1)?.body).toEqual({ config: { display: { compact: true }, runtime: { nofile_soft_limit: 42 } } });
    expect(t.fake.config.raw).toContain('sk-test-model-0001');
  });

  it('refuses unknown, model, mistyped and masked fields', async () => {
    const t = await testApp();
    const v = await version(t);
    const cases: [Record<string, unknown>, string][] = [
      [{ 'nope.field': 1 }, 'unknown_field'],
      [{ model: 'x' }, 'model_field'],
      [{ 'runtime.nofile_soft_limit': 'abc' }, 'invalid_field'],
      [{ 'display.compact': null }, 'invalid_field'],
      [{ 'tts.provider': '«secret:0123abcd»' }, 'secret_placeholder'],
    ];
    for (const [changes, code] of cases) {
      const res = await t.request('PUT', BASE, { changes, version: v });
      expect(res.status, code).toBe(400);
      expect(res.json.code).toBe(code);
    }
    expect(dashCalls(t, 'PUT', '/api/config')).toHaveLength(0);
  });

  it('refuses a stale version without writing, accepts the version returned by another write', async () => {
    const t = await testApp();
    const v = await version(t);
    t.fake.config.setRaw(`${t.fake.config.raw}\n# changed elsewhere\n`);
    const stale = await t.request('PUT', BASE, { changes: { 'display.compact': true }, version: v });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('config_changed');
    expect(dashCalls(t, 'PUT', '/api/config')).toHaveLength(0);

    const env = await t.request('PUT', `${BASE}/env`, { key: 'INTENDIA_TEST', value: 'abc' });
    expect(env.status).toBe(200);
    const ok = await t.request('PUT', BASE, { changes: { 'display.compact': true }, version: env.json.version });
    expect(ok.status).toBe(200);
  });

  it('serialises two writes with the same version: one wins, the other gets 409', async () => {
    const t = await testApp();
    const v = await version(t);
    const [a, b] = await Promise.all([
      t.request('PUT', BASE, { changes: { 'runtime.nofile_soft_limit': 7 }, version: v }),
      t.request('PUT', BASE, { changes: { 'runtime.nofile_soft_limit': 8 }, version: v }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe('config: YAML editor', () => {
  it('puts the secrets back, validates against the schema, accepts model as a table', async () => {
    const t = await testApp();
    const { yaml, version: v } = (await t.request('GET', `${BASE}/raw`)).json;
    const draft = yaml.replace(/^ {2}compact: false/m, '  compact: true');
    const res = await t.request('PUT', `${BASE}/raw`, { yaml: draft, version: v });
    expect(res.status).toBe(200);
    const sent = dashCalls(t, 'PUT', '/api/config/raw').at(-1)?.body as { yaml_text: string };
    const doc = parse(sent.yaml_text).toJS();
    expect(doc.model.api_key).toBe('sk-test-model-0001');
    expect(doc.mcp_servers.demo.headers.Authorization).toBe('Bearer sk-test-mcp-0002');
    expect(doc.display.compact).toBe(true);
  });

  it('reports YAML and schema errors with their position', async () => {
    const t = await testApp();
    const v = await version(t);
    const bad = await t.request('PUT', `${BASE}/raw`, { yaml: 'a: [1\n', version: v });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('invalid_yaml');
    expect(bad.json.line).toBeTypeOf('number');
    const typed = await t.request('PUT', `${BASE}/raw`, { yaml: 'runtime:\n  nofile_soft_limit: abc\n', version: v });
    expect(typed.json).toMatchObject({ code: 'invalid_field', paths: ['runtime.nofile_soft_limit'] });
    const unknown = await t.request('PUT', `${BASE}/raw`, { yaml: 'a:\n  api_key: «secret:deadbeef»\n', version: v });
    expect(unknown.json).toMatchObject({ code: 'secret_placeholder', path: 'a.api_key' });
    expect(dashCalls(t, 'PUT', '/api/config/raw')).toHaveLength(0);
  });
});

describe('config: history', () => {
  it('keeps ten encrypted copies per profile and skips identical ones', async () => {
    const t = await testApp();
    for (let i = 0; i < HISTORY_KEEP + 1; i++) {
      const res = await t.request('PUT', BASE, { changes: { 'runtime.nofile_soft_limit': 100 + i }, version: await version(t) });
      expect(res.status).toBe(200);
    }
    const list = (await t.request('GET', `${BASE}/versions`)).json.versions;
    expect(list).toHaveLength(HISTORY_KEEP);
    expect(list[0]).toMatchObject({ source: 'form', readable: true });
    for (const row of t.db.select().from(configVersions).all()) expect(row.configJson).not.toMatch(/sk-test/);

    // no outside change between two writes of the same value: no new copy
    const before = list.length;
    const v = await version(t);
    await t.request('PUT', BASE, { changes: { 'runtime.nofile_soft_limit': 110 }, version: v });
    expect((await t.request('GET', `${BASE}/versions`)).json.versions).toHaveLength(before);
  });

  it('separates profiles and restores a copy', async () => {
    const t = await testApp();
    const start = t.fake.config.raw;
    await t.request('PUT', BASE, { changes: { 'runtime.nofile_soft_limit': 5 }, version: await version(t) });
    expect((await t.request('GET', `${BASE}/versions?profile=coder`)).json.versions).toHaveLength(0);
    const [copy] = (await t.request('GET', `${BASE}/versions`)).json.versions;
    expect((await t.request('GET', `${BASE}/versions/${copy.id}?profile=coder`)).status).toBe(404);
    const shown = (await t.request('GET', `${BASE}/versions/${copy.id}`)).json.yaml;
    expect(shown).not.toMatch(LEAKS);

    const res = await t.request('POST', `${BASE}/versions/${copy.id}/restore`, { version: await version(t) });
    expect(res.status).toBe(200);
    expect(t.fake.config.raw).toBe(start);
    const after = (await t.request('GET', `${BASE}/versions`)).json.versions;
    expect(after[0].source).toBe('restore');
  });

  it('marks a copy encrypted with another secret as unreadable', async () => {
    const t = await testApp();
    t.db.insert(configVersions).values({
      instanceId: 'fake', profile: 'default', createdAt: Date.now(),
      configJson: JSON.stringify({ format: 'yaml', source: 'form', hash: '0'.repeat(16), enc: encrypt('y'.repeat(40), 'a: 1', 'config-history-v1') }),
    }).run();
    const [row] = (await t.request('GET', `${BASE}/versions`)).json.versions;
    expect(row.readable).toBe(false);
    expect((await t.request('GET', `${BASE}/versions/${row.id}`)).status).toBe(404);
    expect((await t.request('POST', `${BASE}/versions/${row.id}/restore`, { version: await version(t) })).status).toBe(404);
  });
});

describe('config: models', () => {
  it('lists main, providers and auxiliary tasks from the responses', async () => {
    const t = await testApp();
    const m = (await t.request('GET', `${BASE}/models`)).json;
    expect(m.main.model).toBe('anthropic/claude-opus-4.6');
    expect(m.providers.length).toBeGreaterThan(0);
    expect(m.providers[0]).toHaveProperty('keyEnv');
    expect(m.auxiliary.map((a: { task: string }) => a.task)).toContain('vision');
    expect(dashCalls(t, 'GET', '/api/model/options').at(-1)?.query).toMatchObject({ include_unconfigured: 'true' });
  });

  it('asks for confirmation of an expensive model and never sends api_key or base_url', async () => {
    const t = await testApp();
    const body = { scope: 'main', provider: 'openrouter', model: 'cher-1', version: await version(t) };
    const first = await t.request('POST', `${BASE}/models`, body);
    expect(first.status).toBe(409);
    expect(first.json).toMatchObject({ code: 'confirm_required', message: 'Modèle coûteux : confirmer ?' });
    const ok = await t.request('POST', `${BASE}/models`, { ...body, confirm: true, version: await version(t) });
    expect(ok.status).toBe(200);
    const sent = dashCalls(t, 'POST', '/api/model/set').map((r) => r.body as Record<string, unknown>);
    expect(sent.at(-1)).toMatchObject({ confirm_expensive_model: true, model: 'cher-1' });
    for (const b of sent) {
      expect(b).not.toHaveProperty('api_key');
      expect(b).not.toHaveProperty('base_url');
    }
    // the refused attempt wrote nothing: a single copy
    expect((await t.request('GET', `${BASE}/versions`)).json.versions).toHaveLength(1);
  });

  it('checks the auxiliary task and masks the notice', async () => {
    const t = await testApp();
    const v = await version(t);
    expect((await t.request('POST', `${BASE}/models`, { scope: 'auxiliary', provider: 'p', model: 'm', version: v })).json.code).toBe('invalid_task');
    expect((await t.request('POST', `${BASE}/models`, { scope: 'main', provider: 'p', model: 'm', task: 'vision', version: v })).json.code).toBe('invalid_task');
    const aux = await t.request('POST', `${BASE}/models`, { scope: 'auxiliary', task: 'vision', provider: 'openrouter', model: 'x', version: v });
    expect(aux.status).toBe(200);
    const notice = await t.request('POST', `${BASE}/models`, { scope: 'main', provider: 'p', model: 'avec-notice', version: await version(t) });
    expect(notice.json.notice).toContain('«secret:');
    expect(JSON.stringify(notice.json)).not.toMatch(LEAKS);
  });
});

describe('config: env', () => {
  it('validates keys and values, maps Hermes refusals and 404', async () => {
    const t = await testApp();
    expect((await t.request('PUT', `${BASE}/env`, { key: '1BAD', value: 'x' })).json.code).toBe('invalid_key');
    expect((await t.request('PUT', `${BASE}/env`, { key: 'GOOD', value: '«redacted:abcd...wxyz»' })).json.code).toBe('invalid_value');
    expect((await t.request('PUT', `${BASE}/env`, { key: 'GOOD', value: '' })).json.code).toBe('invalid_value');
    const refused = await t.request('PUT', `${BASE}/env`, { key: 'PATH', value: '/bin' });
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('hermes_refused');
    expect((await t.request('PUT', `${BASE}/env`, { key: 'INTENDIA_TEST', value: 'v' })).status).toBe(200);
    expect((await t.request('DELETE', `${BASE}/env/INTENDIA_TEST`)).status).toBe(200);
    expect((await t.request('DELETE', `${BASE}/env/INTENDIA_TEST`)).status).toBe(404);
  });
});

describe('config: MCP', () => {
  it('adds, refuses a duplicate, removes with the token env and reports a token left', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${BASE}/mcp`, { name: 'bad name', url: 'https://h/mcp' })).json.code).toBe('invalid_name');
    expect((await t.request('POST', `${BASE}/mcp`, { name: 'x', url: 'https://h/mcp', command: 'npx' })).json.code).toBe('invalid_mcp');
    expect((await t.request('POST', `${BASE}/mcp`, { name: 'x', command: 'npx', token: 't' })).json.code).toBe('invalid_mcp');
    const add = await t.request('POST', `${BASE}/mcp`, { name: 'Tools-1', url: 'https://tools.example.test/mcp', token: 'sk-test-new-0009' });
    expect(add.status).toBe(201);
    expect(dashCalls(t, 'POST', '/api/mcp/servers').at(-1)?.body).toMatchObject({ auth: 'header', bearer_token: 'sk-test-new-0009' });
    const dup = await t.request('POST', `${BASE}/mcp`, { name: 'Tools-1', url: 'https://tools.example.test/mcp' });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe('hermes_conflict');

    expect((await t.request('DELETE', `${BASE}/mcp/demo`)).json.tokenLeft).toBeUndefined();
    expect(dashCalls(t, 'DELETE', '/api/env').at(-1)?.body).toEqual({ key: 'MCP_DEMO_API_KEY' });
    // no token stored for this one: the 404 of the second deletion is ignored
    await t.request('POST', `${BASE}/mcp`, { name: 'plain', url: 'https://plain.example.test/mcp' });
    const plain = await t.request('DELETE', `${BASE}/mcp/plain`);
    expect(plain.status).toBe(200);
    expect(plain.json.tokenLeft).toBeUndefined();
  });

  it('reports the token left when its deletion fails', async () => {
    const t = await testApp({ breaks: { 'dash DELETE /api/env': { status: 500 } } });
    const res = await t.request('DELETE', `${BASE}/mcp/demo`);
    expect(res.status).toBe(200);
    expect(res.json.tokenLeft).toBe('MCP_DEMO_API_KEY');
  });

  it('tests and toggles a server', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${BASE}/mcp/demo/test`)).json).toEqual({ ok: true, tools: ['ping'] });
    expect((await t.request('PUT', `${BASE}/mcp/demo/enabled`, { enabled: false })).status).toBe(200);
    expect((await t.request('GET', `${BASE}/mcp`)).json.servers.find((s: { name: string }) => s.name === 'demo').enabled).toBe(false);
    expect((await t.request('POST', `${BASE}/mcp/nope/test`)).status).toBe(404);
  });
});

describe('config: gateway restart', () => {
  it('follows a restart to the end, other actions still reach the skills store', async () => {
    const t = await testApp();
    expect((await t.request('GET', `${BASE}/gateway/restart`)).json).toEqual({ running: false, exitCode: null, lines: [], truncated: false });
    expect((await t.request('POST', `${BASE}/gateway/restart`)).status).toBe(202);
    let s: { running: boolean; exitCode: number | null; lines: string[] } = { running: true, exitCode: null, lines: [] };
    for (let i = 0; i < 100 && s.running; i++) {
      await sleep(5);
      s = (await t.request('GET', `${BASE}/gateway/restart`)).json;
    }
    expect(s.running).toBe(false);
    expect(s.exitCode).toBe(0);
    expect(s.lines.join('\n')).toContain('Gateway restarted');
    expect((await t.request('GET', '/x/i/fake/skills/hub/actions/skills-hub-install')).status).toBe(404);
    expect(dashCalls(t, 'GET', '/api/actions/skills-hub-install/status')).toHaveLength(1);
  });
});

describe('config: without the raw config', () => {
  it('keeps reads, refuses config writes, lets env writes through without copy', async () => {
    const t = await testApp({ breaks: { 'dash GET /api/config/raw': { status: 404 } } });
    const form = await t.request('GET', BASE);
    expect(form.status).toBe(200);
    expect(form.json.version).toBeNull();
    const put = await t.request('PUT', BASE, { changes: { 'display.compact': true }, version: '0'.repeat(16) });
    expect(put.status).toBe(409);
    expect(put.json.code).toBe('config_unavailable');
    const env = await t.request('PUT', `${BASE}/env`, { key: 'INTENDIA_TEST', value: 'v' });
    expect(env.json).toEqual({ version: null });
    expect((await t.request('GET', `${BASE}/versions`)).json.versions).toHaveLength(0);
    expect((await t.request('GET', `${BASE}/raw`)).status).toBe(409);
  });

  it('treats a raw error after startup the same way', async () => {
    const t = await testApp();
    const v = await version(t);
    t.fake.config.failRaw = 409;
    const put = await t.request('PUT', BASE, { changes: { 'display.compact': true }, version: v });
    expect(put.json.code).toBe('config_unavailable');
  });
});
