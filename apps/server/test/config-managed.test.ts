import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

/** Lot C, C1: managed installation (Hermes answers ok and writes nothing) and writes without effect. */
const BASE = '/x/i/fake/config';
type T = Awaited<ReturnType<typeof testApp>>;
const calls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);
const version = async (t: T) => (await t.request('GET', `${BASE}/raw`)).json.version as string;
const copies = async (t: T) => (await t.request('GET', `${BASE}/versions`)).json.versions as unknown[];

describe('config: managed installation (flag)', () => {
  it('refuses every config.yaml write with config_managed, without a history copy; .env still writes', async () => {
    const t = await testApp({ managed: 'flag' });
    expect((await t.request('GET', BASE)).json.managed).toBe(true);
    expect((await t.request('GET', `${BASE}/raw`)).json.managed).toBe(true);
    const v = await version(t);
    const tries = [
      await t.request('PUT', BASE, { changes: { 'display.compact': true }, version: v }),
      await t.request('PUT', `${BASE}/raw`, { yaml: 'x_new: 1\n', version: v }),
      await t.request('POST', `${BASE}/models`, { scope: 'main', provider: 'openrouter', model: 'autre-1', version: v }),
      await t.request('POST', `${BASE}/custom-providers`, { name: 'Local', baseUrl: 'http://127.0.0.1:9999/v1' }),
      await t.request('POST', `${BASE}/mcp`, { name: 'neuf', url: 'https://mcp.example.test/mcp' }),
    ];
    for (const r of tries) {
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('config_managed');
    }
    expect(await copies(t)).toHaveLength(0);
    expect(calls(t, 'PUT', '/api/config')).toHaveLength(0);
    expect(calls(t, 'PUT', '/api/config/raw')).toHaveLength(0);
    expect((await t.request('PUT', `${BASE}/env`, { key: 'MY_VAR', value: 'abc' })).status).toBe(200);
  });

  it('refuses a restore too', async () => {
    const t = await testApp({ managed: 'flag' });
    // an .env write still copies the file first
    expect((await t.request('PUT', `${BASE}/env`, { key: 'MY_VAR', value: 'abc' })).status).toBe(200);
    const [copy] = (await copies(t)) as { id: number }[];
    const r = await t.request('POST', `${BASE}/versions/${copy!.id}/restore`, { version: await version(t) });
    expect(r.json.code).toBe('config_managed');
  });

  it('asks with the profile of the request', async () => {
    const t = await testApp({ managed: 'flag' });
    await t.request('GET', `${BASE}?profile=autre`);
    expect(calls(t, 'GET', '/api/shared-metrics/consent').some((r) => r.query?.profile === 'autre')).toBe(true);
  });
});

describe('config: writes without effect', () => {
  it('silent managed: the form gives not_applied and the copy is dropped', async () => {
    const t = await testApp({ managed: 'silent' });
    expect((await t.request('GET', BASE)).json.managed).toBeNull();
    const r = await t.request('PUT', BASE, { changes: { 'display.compact': true }, version: await version(t) });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('not_applied');
    expect(await copies(t)).toHaveLength(0);
  });

  it('an identical YAML (reordered) answers 200 without any PUT', async () => {
    const t = await testApp();
    const before = (await t.request('GET', `${BASE}/raw`)).json;
    const lines = before.yaml.split('\n');
    // same content: an added comment and trailing blank lines
    const r = await t.request('PUT', `${BASE}/raw`, { yaml: `# note\n${lines.join('\n')}\n\n`, version: before.version });
    expect(r.status).toBe(200);
    expect(r.json.version).toBe(before.version);
    expect(calls(t, 'PUT', '/api/config/raw')).toHaveLength(0);
    expect(await copies(t)).toHaveLength(0);
  });

  it('a form value equal to the effective one is not sent', async () => {
    const t = await testApp();
    const form = (await t.request('GET', BASE)).json;
    expect(form.values['display.compact']).toBe(false);
    const r = await t.request('PUT', BASE, { changes: { 'display.compact': false }, version: form.version });
    expect(r.status).toBe(200);
    expect(calls(t, 'PUT', '/api/config')).toHaveLength(0);
  });

  it('a key fixed by an administrator gives not_applied with its path, the free path is written', async () => {
    const t = await testApp();
    t.fake.config.pinned = ['display.compact'];
    const r = await t.request('PUT', BASE, { changes: { 'display.compact': true, 'runtime.nofile_soft_limit': 42 }, version: await version(t) });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'not_applied', paths: ['display.compact'] });
    expect((await t.request('GET', BASE)).json.values['runtime.nofile_soft_limit']).toBe(42);
  });

  it('the model already in place is not sent', async () => {
    const t = await testApp();
    const m = (await t.request('GET', `${BASE}/models`)).json;
    const r = await t.request('POST', `${BASE}/models`, { scope: 'main', provider: m.main.provider, model: m.main.model, version: await version(t) });
    expect(r.status).toBe(200);
    expect(calls(t, 'POST', '/api/model/set')).toHaveLength(0);
  });

  it('a catalog install done in the background is not not_applied', async () => {
    const t = await testApp();
    t.fake.config.mcpCatalog.installBackground = true;
    const r = await t.request('POST', `${BASE}/mcp/catalog/taches-pro`, { env: { TACHES_CLIENT_ID: 'id-1', TACHES_CLIENT_SECRET: 'tres-secret-valeur-42' } });
    expect(r.status).toBe(201);
    expect(r.json.background).toBe(true);
  });
});
