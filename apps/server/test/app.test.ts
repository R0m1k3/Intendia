import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth/auth.js';
import { CompatService } from '../src/compat/service.js';
import type { Notifier } from '../src/compat/notify.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { InstanceStore } from '../src/instances/store.js';
import { createServices } from '../src/services.js';
import { fakeHttp, fakeInstance, tempDir } from './helpers.js';

function setup(env: Record<string, string> = {}) {
  const dataDir = tempDir();
  const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_TRUST_PROXY: 'true', ...env });
  const db = openDb(dataDir);
  const store = new InstanceStore(db, config);
  const auth = new Auth(db, config);
  const changes: unknown[] = [];
  const notifier: Notifier = { moduleStates: async (_r, c) => void changes.push(...c) };
  const { fetchImpl, fake } = fakeHttp();
  const compat = new CompatService(db, store, notifier, fetchImpl);
  const app = createApp({ config, db, auth, store, compat, fetchImpl, services: createServices({ config, db, store, compat }), version: 'test' });
  let cookie = '';
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Intendia': '1', 'X-Forwarded-For': '10.0.0.1', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return { status: res.status, json: (await res.json().catch(() => null)) as any, setCookie: set };
  };
  return { app, auth, req, store, changes, fake, clearCookie: () => (cookie = '') };
}

const PASSWORD = 'correct horse battery';

describe('first start and login', () => {
  it('requires the installation code printed in the logs to choose the password', async () => {
    const t = setup();
    expect((await t.req('GET', '/x/setup')).json).toMatchObject({ needsPassword: true, needsInstance: true });
    expect((await t.req('POST', '/x/setup/password', { code: 'wrong', password: PASSWORD })).status).toBe(403);
    const ok = await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toMatch(/HttpOnly/i);
    expect(ok.setCookie).toMatch(/SameSite=Strict/i);
    // cannot be replayed once a password exists
    expect((await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD })).status).toBe(409);
  });

  it('rejects short passwords', async () => {
    const t = setup();
    expect((await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: 'short' })).status).toBe(400);
  });

  it('logs in, protects private routes, and limits attempts to five per minute', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    await t.req('POST', '/x/logout', {});
    t.clearCookie();
    expect((await t.req('GET', '/x/instances')).status).toBe(401);
    // 2 attempts already used by setup + logout? logout is not rate limited; setup used 1.
    expect((await t.req('POST', '/x/login', { password: 'nope' })).status).toBe(401);
    expect((await t.req('POST', '/x/login', { password: PASSWORD })).status).toBe(200);
    expect((await t.req('GET', '/x/instances')).status).toBe(200);
    for (let i = 0; i < 2; i++) await t.req('POST', '/x/login', { password: 'nope' });
    expect((await t.req('POST', '/x/login', { password: PASSWORD })).status).toBe(429);
  });

  it('refuses mutating requests without the X-Intendia header', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    const res = await t.req('POST', '/x/instances/test', fakeInstance(), { 'X-Intendia': '' });
    expect(res.status).toBe(403);
  });
});

describe('instances', () => {
  it('puts the share_file entry into Hermes when an instance is added, never over another one', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    const saved = await t.req('POST', '/x/instances', fakeInstance());
    expect(saved.json.mcp).toEqual({ state: 'connected' });
    expect(t.fake.config.raw).toContain('Authorization: Bearer ${MCP_INTENDIA_API_KEY}');
    expect(t.fake.requests.some((r) => r.path.endsWith('/test'))).toBe(false);

    const other = setup();
    await other.req('POST', '/x/setup/password', { code: other.auth.setupCode, password: PASSWORD });
    other.fake.config.setRaw(other.fake.config.raw.replace(/\nmcp_servers:\n/, '\nmcp_servers:\n  intendia:\n    url: https://elsewhere.example.test/mcp\n'));
    const kept = await other.req('POST', '/x/instances', fakeInstance());
    expect(kept.status).toBe(200);
    expect(kept.json.mcp).toEqual({ state: 'other_url' });
    expect(other.fake.config.raw).toContain('https://elsewhere.example.test/mcp');
  });

  it('tests then saves an instance, keys encrypted at rest, and exposes its report', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    const saved = await t.req('POST', '/x/instances', fakeInstance());
    expect(saved.status).toBe(200);
    expect(saved.json.report.modules).toHaveLength(8);
    expect(JSON.stringify(saved.json.instance)).not.toContain('fake-api-key');
    const list = await t.req('GET', '/x/instances');
    expect(list.json.instances[0]).toMatchObject({ id: 'fake', source: 'db' });
    const compat = await t.req('GET', '/x/compat');
    expect(compat.json.reports[0].hermesVersion).toBe('0.23.0');
  });

  it('refuses to save an instance whose API server does not answer', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    const res = await t.req('POST', '/x/instances', fakeInstance({ api: 'http://nowhere' }));
    expect(res.status).toBe(422);
    expect(t.store.list()).toHaveLength(0);
  });

  it('declarative instances (INTENDIA_INSTANCES) cannot be edited from the UI', async () => {
    const t = setup({ INTENDIA_INSTANCES: JSON.stringify([fakeInstance()]) });
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    expect((await t.req('GET', '/x/instances')).json).toMatchObject({ declarative: true });
    const res = await t.req('DELETE', '/x/instances/fake');
    expect(res.status).toBe(500);
    expect(t.store.list()).toHaveLength(1);
  });
});
