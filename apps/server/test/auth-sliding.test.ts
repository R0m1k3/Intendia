import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { Auth, requireAuth } from '../src/auth/auth.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { authSessions } from '../src/db/schema.js';
import { tempDir } from './helpers.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 12);

function setup() {
  const dataDir = tempDir();
  const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir });
  const db = openDb(dataDir);
  const auth = new Auth(db, config);
  const app = new Hono();
  app.post('/login', (c) => { auth.createSession(c); return c.json({ ok: true }); });
  const priv = new Hono();
  priv.use('*', requireAuth(auth));
  priv.get('/ping', (c) => c.json({ ok: true }));
  priv.post('/ping', (c) => c.json({ ok: true }));
  app.route('/', priv);
  let cookie = '';
  const req = async (method: string, path: string, headers: Record<string, string> = { 'X-Intendia': '1' }) => {
    const res = await app.request(path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return { status: res.status, json: (await res.json().catch(() => null)) as any, setCookie: set };
  };
  const row = () => db.select().from(authSessions).where(eq(authSessions.id, cookie.split('=')[1]!)).get();
  return { req, row, db };
}

const at = (days: number) => vi.setSystemTime(T0 + days * DAY);

describe('sliding session', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); at(0); });
  afterEach(() => vi.useRealTimers());

  it('pushes the end back on use, writing the cookie once a day at most', async () => {
    const t = setup();
    await t.req('POST', '/login');
    at(2);
    const first = await t.req('GET', '/ping');
    expect(first.status).toBe(200);
    expect(first.setCookie).toContain('Max-Age=2592000');
    expect(t.row()!.expiresAt).toBe(T0 + 32 * DAY);
    expect((await t.req('GET', '/ping')).setCookie).toBeNull();
  });

  it('stops 90 days after sign-in', async () => {
    const t = setup();
    await t.req('POST', '/login');
    const createdAt = t.row()!.createdAt;
    for (const d of [20, 40, 60, 80]) {
      at(d);
      expect((await t.req('GET', '/ping')).status).toBe(200);
    }
    at(89);
    expect((await t.req('GET', '/ping')).status).toBe(200);
    expect(t.row()!.expiresAt).toBe(createdAt + 90 * DAY);
    at(89.5);
    expect((await t.req('GET', '/ping')).setCookie).toBeNull();
    expect((await t.req('GET', '/ping')).setCookie).toBeNull();
    at(91);
    const late = await t.req('GET', '/ping');
    expect(late.status).toBe(401);
    expect(late.json.code).toBe('unauthenticated');
  });

  it('no write when used twice the same day after day 61', async () => {
    const t = setup();
    await t.req('POST', '/login');
    for (const d of [20, 40, 61]) { at(d); await t.req('GET', '/ping'); }
    at(62);
    expect((await t.req('GET', '/ping')).setCookie).toBeNull();
    at(62.2);
    expect((await t.req('GET', '/ping')).setCookie).toBeNull();
  });

  it('expires after 30 days without use', async () => {
    const t = setup();
    await t.req('POST', '/login');
    at(31);
    const r = await t.req('GET', '/ping');
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ code: 'unauthenticated', error: 'Session expirée : reconnectez-vous' });
  });

  it('a deleted row is refused', async () => {
    const t = setup();
    await t.req('POST', '/login');
    t.db.delete(authSessions).run();
    expect((await t.req('GET', '/ping')).status).toBe(401);
  });

  it('a POST without X-Intendia is refused and does not extend', async () => {
    const t = setup();
    await t.req('POST', '/login');
    const before = t.row()!.expiresAt;
    at(5);
    const r = await t.req('POST', '/ping', {});
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('csrf');
    expect(r.setCookie).toBeNull();
    expect(t.row()!.expiresAt).toBe(before);
  });
});
