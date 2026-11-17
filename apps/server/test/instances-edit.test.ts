import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_API_KEY, FAKE_DASH_TOKEN } from 'fake-hermes';
import { decrypt } from '../src/crypto.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { InstanceStore, mergeInstance } from '../src/instances/store.js';
import { fakeInstance, tempDir, testApp } from './helpers.js';

// spy on decrypt (InstanceStore cache), the real function still runs
vi.mock('../src/crypto.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/crypto.js')>();
  return { ...real, decrypt: vi.fn(real.decrypt) };
});

const KANBAN = '/x/i/fake/kanban/board?board=default';
const PROFILE_KEY = 'p'.repeat(20);

afterEach(() => {
  vi.restoreAllMocks();
});

async function app(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp({ dbInstances: true, ...opts });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return t;
}

describe('PATCH /x/instances/:id', () => {
  it('a new dashboard token: saved, checked with it, MCP token kept, next calls send it', async () => {
    const t = await app();
    const mcpBefore = (await t.request('GET', '/x/instances/fake/mcp')).json.token;
    t.fake.auth.dashToken = 'neuf-jeton-du-dashboard';
    await t.compat.check('fake');
    expect(t.compat.get('fake')!.dash.auth).toBe('refused');
    const res = await t.request('PATCH', '/x/instances/fake', { dashboardToken: 'neuf-jeton-du-dashboard' });
    expect(res.status).toBe(200);
    expect(res.json.report.dash.auth).toBe('ok');
    expect(res.json.mcp.state).toBeDefined();
    expect(JSON.stringify(res.json)).not.toContain('neuf-jeton-du-dashboard');
    expect(t.store.get('fake')!.dashboardToken).toBe('neuf-jeton-du-dashboard');
    expect(t.store.get('fake')!.apiKey).toBe(FAKE_API_KEY);
    expect((await t.request('GET', '/x/instances/fake/mcp')).json.token).toBe(mcpBefore);
    const n = t.fake.requests.length;
    expect((await t.request('GET', KANBAN)).status).toBe(200);
    const sent = t.fake.requests.slice(n).filter((r) => r.via === 'dash');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((r) => r.authorization === 'Bearer neuf-jeton-du-dashboard')).toBe(true);
    t.compat.stop();
  });

  it('only the dashboard token while the API server is down: 200 (no 422)', async () => {
    const t = await app();
    t.fake.down.add('api');
    const res = await t.request('PATCH', '/x/instances/fake', { dashboardToken: 'autre-jeton-valable' });
    expect(res.status).toBe(200);
    expect(res.json.report.outage?.api).toBe(true);
    expect(t.store.get('fake')!.dashboardToken).toBe('autre-jeton-valable');
    t.compat.stop();
  });

  it('an empty apiKey keeps the saved key', async () => {
    const t = await app();
    const res = await t.request('PATCH', '/x/instances/fake', { apiKey: '', dashboardLink: 'https://dash2.example.test' });
    expect(res.status).toBe(200);
    expect(t.store.get('fake')!.apiKey).toBe(FAKE_API_KEY);
    expect(t.store.get('fake')!.dashboardLink).toBe('https://dash2.example.test');
    t.compat.stop();
  });

  it('a new API origin without apiKey: 400, nothing saved, no request to Hermes', async () => {
    const t = await app();
    const n = t.fake.requests.length;
    const res = await t.request('PATCH', '/x/instances/fake', { api: 'http://other-api:8642' });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'secret_required', field: 'apiKey' });
    expect(t.store.get('fake')!.api).toBe('http://fake-api');
    expect(t.fake.requests.length).toBe(n);
    // the same origin with another path keeps the key
    expect(mergeInstance(fakeInstance(), { api: 'http://fake-api/' }).apiKey).toBe(FAKE_API_KEY);
    // a new dashboard origin needs its token
    const dash = await t.request('PATCH', '/x/instances/fake', { dashboard: 'http://other-dash:9119' });
    expect(dash.status).toBe(400);
    expect(dash.json.field).toBe('dashboardToken');
    t.compat.stop();
  });

  it('a new API origin with its key: other Hermes checked, profile keys dropped unless sent again, MCP entry written', async () => {
    const t = await app({ profileKeys: { ancien: PROFILE_KEY }, extra: [{ id: 'x', ownFake: true }] });
    const other = t.fakes.x!;
    const res = await t.request('PATCH', '/x/instances/fake', {
      api: 'http://x-api', apiKey: FAKE_API_KEY, dashboard: 'http://x-dash', dashboardToken: FAKE_DASH_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.json.report.api.reachable).toBe(true);
    const saved = t.store.get('fake')!;
    expect(saved.api).toBe('http://x-api');
    expect(saved.profileKeys).toEqual({});
    // the share_file entry went to the new Hermes
    expect(['connected', 'stale']).toContain(res.json.mcp.state);
    expect(other.requests.some((r) => r.method !== 'GET')).toBe(true);
    expect(t.fake.requests.filter((r) => r.method !== 'GET')).toHaveLength(0);
    t.compat.stop();
  });

  it('a dashboard origin that does not answer: 200, report with outage.dash, nothing kept from the old host', async () => {
    const t = await app();
    const res = await t.request('PATCH', '/x/instances/fake', { dashboard: 'http://nowhere-dash:9119', dashboardToken: 'jeton-du-nouvel-hote' });
    expect(res.status).toBe(200);
    const r = res.json.report;
    expect(r.outage?.dash).toBe(true);
    expect(r.dash.reachable).toBe(false);
    expect(r.files?.workspaceRoot ?? null).toBeNull();
    const kanban = r.modules.find((m: { id: string }) => m.id === 'kanban');
    expect(kanban.state).toBe('unavailable');
    for (const op of Object.values(kanban.ops) as { ok: boolean; route?: { via: string } }[]) expect(op.ok).toBe(false);
    t.compat.stop();
  });

  it('profileKeys: merged by name, null removes one', async () => {
    const t = await app({ profileKeys: { garde: PROFILE_KEY } });
    const add = await t.request('PATCH', '/x/instances/fake', { profileKeys: { agent: 'a'.repeat(20) } });
    expect(add.status).toBe(200);
    expect(t.store.get('fake')!.profileKeys).toEqual({ garde: PROFILE_KEY, agent: 'a'.repeat(20) });
    expect(add.json.instance.profiles.sort()).toEqual(['agent', 'garde']);
    const del = await t.request('PATCH', '/x/instances/fake', { profileKeys: { agent: null } });
    expect(del.status).toBe(200);
    expect(t.store.get('fake')!.profileKeys).toEqual({ garde: PROFILE_KEY });
    // too short a key: 400
    expect((await t.request('PATCH', '/x/instances/fake', { profileKeys: { court: 'abc' } })).status).toBe(400);
    t.compat.stop();
  });

  it('dashboard: null removes the dashboard and its token; its modules say "not configured"', async () => {
    const t = await app();
    const res = await t.request('PATCH', '/x/instances/fake', { dashboard: null, dashboardToken: 'ignore-ce-jeton' });
    expect(res.status).toBe(200);
    const saved = t.store.get('fake')!;
    expect(saved.dashboard).toBeUndefined();
    expect(saved.dashboardToken).toBeUndefined();
    expect(res.json.report.dash.configured).toBe(false);
    const kanban = res.json.report.modules.find((m: { id: string }) => m.id === 'kanban');
    expect(kanban.state).toBe('unavailable');
    expect(kanban.reasons.join(' ')).toContain('non configuré');
    t.compat.stop();
  });

  it('a refused API key: 422 api_key_refused, nothing saved', async () => {
    const t = await app();
    const res = await t.request('PATCH', '/x/instances/fake', { apiKey: 'x'.repeat(20) });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('api_key_refused');
    expect(res.json.error).toContain('Hermes refuse la clé');
    expect(res.json.report.api.auth).toBe('refused');
    expect(t.store.get('fake')!.apiKey).toBe(FAKE_API_KEY);
    t.compat.stop();
  });

  it('the label alone: renamed, no request to Hermes', async () => {
    const t = await app();
    const n = t.fake.requests.length;
    const res = await t.request('PATCH', '/x/instances/fake', { label: 'Hermes maison', apiKey: '', dashboardToken: '' });
    expect(res.status).toBe(200);
    expect(res.json.instance.label).toBe('Hermes maison');
    expect(res.json.report.instanceId).toBe('fake');
    expect(t.fake.requests.length).toBe(n);
    t.compat.stop();
  });

  it('unknown id: 404', async () => {
    const t = await app();
    expect((await t.request('PATCH', '/x/instances/nope', { dashboardToken: 'quelque-chose' })).status).toBe(404);
    expect((await t.request('POST', '/x/instances/nope/test', {})).status).toBe(404);
    t.compat.stop();
  });
});

describe('POST /x/instances/:id/test and POST /x/instances', () => {
  it('tests the merged settings without saving them', async () => {
    const t = await app();
    t.fake.auth.dashToken = 'jeton-a-tester-seulement';
    await t.compat.check('fake');
    const res = await t.request('POST', '/x/instances/fake/test', { dashboardToken: 'jeton-a-tester-seulement' });
    expect(res.status).toBe(200);
    expect(res.json.dash.auth).toBe('ok');
    expect(res.json.instanceId).toBe('fake');
    expect(t.store.get('fake')!.dashboardToken).toBe(FAKE_DASH_TOKEN);
    // the saved report is not replaced by the test
    expect(t.compat.get('fake')!.dash.auth).toBe('refused');
    t.compat.stop();
  });

  it('an existing id: 409 instance_exists, nothing replaced', async () => {
    const t = await app();
    const res = await t.request('POST', '/x/instances', fakeInstance({ label: 'Écrase', dashboardToken: undefined }));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('instance_exists');
    expect(t.store.get('fake')!.label).toBe('Fake');
    expect(t.store.get('fake')!.dashboardToken).toBe(FAKE_DASH_TOKEN);
    t.compat.stop();
  });

  it('a refused API key on a new instance: 422 api_key_refused', async () => {
    const t = await app();
    const res = await t.request('POST', '/x/instances', fakeInstance({ id: 'neuve', apiKey: 'y'.repeat(20) }));
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('api_key_refused');
    expect(t.store.get('neuve')).toBeUndefined();
    t.compat.stop();
  });

  it('a refused dashboard token on a new instance is saved, the report says refused', async () => {
    const t = await app();
    const res = await t.request('POST', '/x/instances', fakeInstance({ id: 'neuve', dashboardToken: 'mauvais-jeton' }));
    expect(res.status).toBe(200);
    expect(res.json.report.dash.auth).toBe('refused');
    expect(t.store.get('neuve')).toBeDefined();
    t.compat.stop();
  });
});

describe('declarative instances (INTENDIA_INSTANCES)', () => {
  it('PATCH, DELETE and POST answer 409 declarative', async () => {
    const t = await testApp();
    for (const [method, path, body] of [
      ['PATCH', '/x/instances/fake', { dashboardToken: 'quelque-chose' }],
      ['PATCH', '/x/instances/fake', { label: 'Autre' }],
      ['DELETE', '/x/instances/fake', undefined],
      ['POST', '/x/instances', fakeInstance({ id: 'neuve' })],
    ] as const) {
      const res = await t.request(method, path, body);
      expect(res.status).toBe(409);
      expect(res.json.code).toBe('declarative');
      expect(res.json.error).toContain('modifiez-les dans la configuration du conteneur');
    }
    expect(t.store.list()).toHaveLength(1);
    t.compat.stop();
  });
});

describe('InstanceStore', () => {
  it('decrypts once until the next write', () => {
    const dir = tempDir();
    const store = new InstanceStore(openDb(dir), loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dir }));
    store.save(fakeInstance());
    store.save(fakeInstance({ id: 'deux', label: 'Deux' }));
    const spy = vi.mocked(decrypt);
    spy.mockClear();
    expect(store.list()).toHaveLength(2);
    expect(store.get('deux')!.label).toBe('Deux');
    expect(spy).toHaveBeenCalledTimes(2); // one per row, once
    store.save(fakeInstance({ id: 'deux', label: 'Nouveau' }));
    expect(store.get('deux')!.label).toBe('Nouveau');
    store.remove('deux');
    expect(store.get('deux')).toBeUndefined();
  });
});
