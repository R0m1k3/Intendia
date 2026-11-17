import { describe, expect, it } from 'vitest';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth/auth.js';
import { CompatService } from '../src/compat/service.js';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/index.js';
import { authSessions, settings } from '../src/db/schema.js';
import { InstanceStore } from '../src/instances/store.js';
import { createServices } from '../src/services.js';
import { fakeHttp, tempDir } from './helpers.js';

const PASSWORD = 'correct horse battery';

function build(dataDir: string, db: Db, env: Record<string, string> = {}) {
  const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_TRUST_PROXY: 'true', ...env });
  const store = new InstanceStore(db, config);
  const auth = new Auth(db, config);
  const { fetchImpl } = fakeHttp();
  const compat = new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl);
  const app = createApp({ config, db, auth, store, compat, fetchImpl, services: createServices({ config, db, store, compat }), version: 'test' });
  let ip = 1;
  const req = async (method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = { 'X-Intendia': '1' }) => {
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${ip++}`, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    return { status: res.status, json: (await res.json().catch(() => null)) as any, cookie: set ? set.split(';')[0]! : '' };
  };
  const login = async () => (await req('POST', '/x/login', '', { password: PASSWORD })).cookie;
  return { auth, req, login };
}

async function withHash() {
  const dataDir = tempDir();
  const db = openDb(dataDir);
  const h = await hash(PASSWORD, { algorithm: 2 });
  return { dataDir, db, h, t: build(dataDir, db, { INTENDIA_PASSWORD_HASH: h }) };
}

describe('sign out every session', () => {
  it('deletes every session and keeps the caller signed in with a new cookie', async () => {
    const { t } = await withHash();
    const a = await t.login();
    const b = await t.login();
    const r = await t.req('POST', '/x/auth/revoke-all', a, {});
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^intendia_session=/);
    expect(r.cookie).not.toBe(a);
    expect((await t.req('GET', '/x/instances', r.cookie)).status).toBe(200);
    for (const old of [a, b]) {
      const res = await t.req('GET', '/x/instances', old);
      expect(res.status).toBe(401);
      expect(res.json.code).toBe('unauthenticated');
    }
  });

  it('needs X-Intendia and a session', async () => {
    const { t } = await withHash();
    const a = await t.login();
    const b = await t.login();
    const r = await t.req('POST', '/x/auth/revoke-all', a, {}, {});
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('csrf');
    expect((await t.req('GET', '/x/instances', a)).status).toBe(200);
    expect((await t.req('GET', '/x/instances', b)).status).toBe(200);
    expect((await t.req('POST', '/x/auth/revoke-all', '', {})).status).toBe(401);
  });
});

describe('purge when the password changes', () => {
  it('keeps sessions with the same hash, purges them with another one', async () => {
    const { dataDir, db, h, t } = await withHash();
    const a = await t.login();
    const same = build(dataDir, db, { INTENDIA_PASSWORD_HASH: h });
    expect((await same.req('GET', '/x/instances', a)).status).toBe(200);
    const other = build(dataDir, db, { INTENDIA_PASSWORD_HASH: await hash('another password here', { algorithm: 2 }) });
    expect((await other.req('GET', '/x/instances', a)).status).toBe(401);
    expect(db.select().from(authSessions).all()).toHaveLength(0);
  });

  it('a database without password_epoch (update from v0.1.4) keeps its sessions', async () => {
    const { dataDir, db, h, t } = await withHash();
    const a = await t.login();
    db.delete(settings).where(eq(settings.key, 'password_epoch')).run();
    const again = build(dataDir, db, { INTENDIA_PASSWORD_HASH: h });
    expect(db.select().from(authSessions).all()).toHaveLength(1);
    expect(db.select().from(settings).where(eq(settings.key, 'password_epoch')).get()?.value).toBeTruthy();
    expect((await again.req('GET', '/x/instances', a)).status).toBe(200);
  });

  it('the first password purges older rows, the setup session stays valid', async () => {
    const dataDir = tempDir();
    const db = openDb(dataDir);
    const t = build(dataDir, db);
    db.insert(authSessions).values({ id: 'stale', createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 }).run();
    const r = await t.req('POST', '/x/setup/password', '', { code: t.auth.setupCode, password: PASSWORD });
    expect(r.status).toBe(200);
    expect(db.select().from(authSessions).where(eq(authSessions.id, 'stale')).get()).toBeUndefined();
    expect((await t.req('GET', '/x/instances', r.cookie)).status).toBe(200);
    expect((await t.req('GET', '/x/instances', 'intendia_session=stale')).status).toBe(401);
  });
});
