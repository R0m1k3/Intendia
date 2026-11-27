import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth/auth.js';
import { CompatService } from '../src/compat/service.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { Retention } from '../src/db/retention.js';
import { authSessions, channelMembers, channelTurns, runStats, sessionWorkspace, shareLinks, workspaces } from '../src/db/schema.js';
import { InstanceStore } from '../src/instances/store.js';
import { JSON_MAX_BYTES } from '../src/routes/body.js';
import { createServices } from '../src/services.js';
import { fakeHttp, tempDir, testApp } from './helpers.js';

const PASSWORD = 'correct horse battery';

function setup(env: Record<string, string> = {}, dataDir = tempDir()) {
  const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, ...env });
  const db = openDb(dataDir);
  const store = new InstanceStore(db, config);
  const auth = new Auth(db, config);
  const { fetchImpl } = fakeHttp();
  const compat = new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl);
  const app = createApp({ config, db, auth, store, compat, fetchImpl, services: createServices({ config, db, store, compat }), version: 'test' });
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Intendia': '1', ...headers }, body });
  return { app, auth, db, post, dataDir };
}

afterEach(() => vi.restoreAllMocks());

describe('request bodies', () => {
  it('answers 400 to a body that is not JSON, and never writes it to the logs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup();
    for (const path of ['/x/login', '/x/setup/password']) {
      const res = await t.post(path, '{"password":"hunter2-secret-value', { 'X-Forwarded-For': `10.1.0.${path.length}` });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Corps illisible', code: 'invalid_body' });
    }
    expect((await t.post('/x/login', '', { 'X-Forwarded-For': '10.1.0.3' })).status).toBe(400);
    expect(logged).not.toHaveBeenCalled();
  });

  it('refuses a body over the limit, with or without Content-Length, but not an upload', async () => {
    const t = await testApp();
    const big = JSON.stringify({ title: 'x'.repeat(JSON_MAX_BYTES) });
    const sized = await t.rawRequest('POST', '/x/prompts', { body: big, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(big)) } });
    expect(sized.status).toBe(413);
    expect((await sized.json()).code).toBe('too_large');
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const chunked = await t.app.request('/x/prompts', {
      method: 'POST', body: stream, duplex: 'half',
      headers: { 'Content-Type': 'application/json', 'X-Intendia': '1', Cookie: t.cookie() },
    } as RequestInit);
    expect(chunked.status).toBe(413);
    expect((await t.request('POST', '/x/workspaces', { slug: 'gros', name: 'Gros', instanceId: 'fake' })).status).toBe(201);
    const up = await t.rawRequest('PUT', '/x/workspaces/gros/files/upload?dir=inbox&name=big.bin', { body: Buffer.alloc(JSON_MAX_BYTES + 1024) });
    expect(up.status).toBe(201);
  });
});

describe('login limit', () => {
  const attempt = (t: ReturnType<typeof setup>, xff: string) => t.post('/x/login', JSON.stringify({ password: 'nope' }), { 'X-Forwarded-For': xff });

  it('counts the address the proxy saw, not the text the client put before it', async () => {
    const t = setup({ INTENDIA_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g' });
    for (let i = 0; i < 5; i++) expect((await attempt(t, `6.6.6.${i}, 203.0.113.7`)).status).toBe(401);
    // a sixth made-up address in front changes nothing
    expect((await attempt(t, '6.6.6.99, 203.0.113.7')).status).toBe(429);
    // another real client still gets in
    expect((await attempt(t, '6.6.6.99, 203.0.113.8')).status).toBe(401);
  });

  it('INTENDIA_TRUSTED_HOPS=2 reads the entry before the last proxy', async () => {
    const t = setup({ INTENDIA_TRUSTED_HOPS: '2', INTENDIA_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g' });
    for (let i = 0; i < 5; i++) await attempt(t, `6.6.6.${i}, 203.0.113.7, 172.18.0.2`);
    expect((await attempt(t, '1.2.3.4, 203.0.113.7, 172.18.0.2')).status).toBe(429);
    expect((await attempt(t, '1.2.3.4, 203.0.113.8, 172.18.0.2')).status).toBe(401);
    // a shorter list than the hops: its first entry
    expect((await attempt(t, '203.0.113.9')).status).toBe(401);
  });
});

describe('sign-in sessions in the database', () => {
  it('keeps a hash of the cookie, and hashes the sessions of an older version in place', async () => {
    const dataDir = tempDir();
    const old = openDb(dataDir);
    old.insert(authSessions).values({ id: 'old-plain-cookie-value', createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 }).run();
    old.$client.close();

    const t = setup({}, dataDir);
    const ids = () => t.db.select().from(authSessions).all().map((r) => r.id);
    expect(ids()).toEqual([createHash('sha256').update('old-plain-cookie-value').digest('hex')]);
    // the browser of before the update is still signed in
    const me = await t.app.request('/x/setup', { headers: { Cookie: 'intendia_session=old-plain-cookie-value' } });
    expect((await me.json()).authenticated).toBe(true);

    await t.post('/x/setup/password', JSON.stringify({ code: t.auth.setupCode, password: PASSWORD }), { 'X-Forwarded-For': '10.2.0.1' });
    const res = await t.post('/x/login', JSON.stringify({ password: PASSWORD }), { 'X-Forwarded-For': '10.2.0.2' });
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!.split('=')[1]!;
    expect(ids()).toContain(createHash('sha256').update(cookie).digest('hex'));
    expect(ids()).not.toContain(cookie);
  });
});

describe('health and headers', () => {
  it('health reads the database', async () => {
    const t = setup();
    expect((await t.app.request('/x/health')).status).toBe(200);
    t.db.$client.close();
    const down = await t.app.request('/x/health');
    expect(down.status).toBe(503);
    expect((await down.json()).ok).toBe(false);
  });

  it('sends HSTS over https only', async () => {
    const t = setup();
    expect((await t.app.request('/x/setup', { headers: { 'X-Forwarded-Proto': 'https' } })).headers.get('strict-transport-security')).toBe('max-age=2592000');
    expect((await t.app.request('/x/setup')).headers.get('strict-transport-security')).toBeNull();
  });

  it('limits /f/:token for a visitor, not for the owner', async () => {
    const t = await testApp();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await t.app.request('/f/unknown-token', { headers: { 'X-Forwarded-For': '198.51.100.4' } })).status;
    expect(last).toBe(429);
    expect((await t.app.request('/f/unknown-token', { headers: { 'X-Forwarded-For': '198.51.100.5' } })).status).toBe(404);
    expect((await t.app.request('/f/unknown-token', { headers: { 'X-Forwarded-For': '198.51.100.4', Cookie: t.cookie() } })).status).toBe(404);
  });
});

describe('retention', () => {
  it('deletes only what nothing reads any more', () => {
    const db = openDb(tempDir());
    const DAY = 86_400_000;
    const now = Date.UTC(2026, 10, 27);
    db.insert(authSessions).values([{ id: 'live', createdAt: now, expiresAt: now + DAY }, { id: 'dead', createdAt: 0, expiresAt: now - 1 }]).run();
    // 60 old closed turns: the last 50 of the channel stay; an old open one stays too
    db.insert(channelTurns).values(Array.from({ length: 60 }, () => ({ channelId: 'c1', handle: 'a', status: 'done', createdAt: now - 40 * DAY }))).run();
    db.insert(channelTurns).values({ channelId: 'c2', handle: 'a', status: 'stopped', createdAt: now - 40 * DAY }).run();
    db.insert(workspaces).values({ slug: 'w', name: 'W', instanceId: 'i', createdAt: now } as typeof workspaces.$inferInsert).run();
    db.insert(sessionWorkspace).values({ sessionId: 'kept', instanceId: 'i', workspaceSlug: 'w', createdAt: now } as typeof sessionWorkspace.$inferInsert).run();
    db.insert(channelMembers).values({ channelId: 'c1', handle: 'a', instanceId: 'i', profile: 'default', sessionId: 'member' }).run();
    const run = (runId: string, sessionId: string, startedAt: number, status = 'completed') => ({ instanceId: 'i', runId, sessionId, status, startedAt });
    db.insert(runStats).values([
      run('r1', 'kept', now - 400 * DAY), run('r2', 'member', now - 400 * DAY), run('r3', 'gone', now - 31 * DAY),
      run('r4', 'gone', now - 2 * DAY), run('r5', 'gone', now - 400 * DAY, 'running'),
    ]).run();
    const link = (token: string, revoked: boolean, createdAt: number) => ({ token, instanceId: 'i', path: 'a.txt', publicUntil: now - DAY, revoked, createdAt });
    db.insert(shareLinks).values([link('expired', false, now - 400 * DAY), link('revoked-old', true, now - 91 * DAY), link('revoked-new', true, now - DAY)]).run();

    const r = new Retention(db);
    expect(r.sweep(now)).toEqual({ sessions: 1, turns: 10, runs: 1, links: 1 });
    expect(db.select().from(runStats).all().map((x) => x.runId).sort()).toEqual(['r1', 'r2', 'r4', 'r5']);
    expect(db.select().from(shareLinks).all().map((x) => x.token).sort()).toEqual(['expired', 'revoked-new']);
    expect(db.select().from(channelTurns).all().filter((x) => x.channelId === 'c2')).toHaveLength(1);
    expect(r.sweep(now)).toEqual({ sessions: 0, turns: 0, runs: 0, links: 0 });
    expect(r.idle).toBe(true);
  });
});
