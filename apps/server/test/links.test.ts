import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

async function setup() {
  const t = await testApp({ instance: { agentMount: '/opt/data/workspace' }, env: { INTENDIA_PUBLIC_URL: 'https://intendia.example.test' } });
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  const ws = join(t.mount, 'dev');
  mkdirSync(join(ws, 'files', 'a_b'));
  mkdirSync(join(ws, 'files', 'axb'));
  writeFileSync(join(ws, 'files', 'a_b', 'r.md'), '# r');
  writeFileSync(join(ws, 'files', 'axb', 'r.md'), '# x');
  writeFileSync(join(ws, 'files', 'note <b>.txt'), 'n');
  const share = async (path: string) => (await t.request('POST', '/x/workspaces/dev/files/share', { path })).json;
  const anon = (path: string) => t.rawRequest('GET', path, { cookie: false });
  return { ...t, ws, share, anon };
}

describe('share links', () => {
  it('creates a private 10-character link and reuses it', async () => {
    const t = await setup();
    const a = await t.share('files/a_b/r.md');
    expect(a.token).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(a.url).toBe(`https://intendia.example.test/f/${a.token}`);
    expect(a.publicUntil).toBeNull();
    expect((await t.share('files/a_b/r.md')).token).toBe(a.token);
  });

  it('the agent never gets a public link; the explorer gets it as it is', async () => {
    const t = await setup();
    const a = await t.share('files/a_b/r.md');
    const until = Date.now() + 86_400_000;
    expect((await t.request('PATCH', `/x/links/${a.token}`, { publicUntil: until })).status).toBe(200);
    expect((await t.share('files/a_b/r.md')).token).toBe(a.token);
    const agent = t.links.share('fake', 'dev/files/a_b/r.md', { forAgent: true });
    expect(agent.token).not.toBe(a.token);
    expect(agent.publicUntil).toBeNull();
  });

  it('share route: folder 400, no session 401, no X-Intendia 403', async () => {
    const t = await setup();
    expect((await t.request('POST', '/x/workspaces/dev/files/share', { path: 'files/a_b' })).status).toBe(400);
    const body = JSON.stringify({ path: 'files/a_b/r.md' });
    const h = { 'Content-Type': 'application/json' };
    expect((await t.rawRequest('POST', '/x/workspaces/dev/files/share', { body, headers: h, cookie: false })).status).toBe(401);
    expect((await t.rawRequest('POST', '/x/workspaces/dev/files/share', { body, headers: h, csrf: false })).status).toBe(403);
  });

  it('/f: private needs login, public until a date, revoked, missing file', async () => {
    const t = await setup();
    const a = await t.share('files/a_b/r.md');
    const priv = await t.anon(`/f/${a.token}`);
    expect(priv.status).toBe(302);
    expect(priv.headers.get('location')).toBe(`/connexion?suite=/f/${a.token}`);
    const mine = await t.rawRequest('GET', `/f/${a.token}`);
    expect(mine.status).toBe(200);
    expect(mine.headers.get('content-security-policy')).toContain('sandbox');
    expect(await mine.text()).toBe('# r');

    await t.request('PATCH', `/x/links/${a.token}`, { publicUntil: Date.now() + 60_000 });
    expect((await t.anon(`/f/${a.token}`)).status).toBe(200);
    t.db.$client.prepare('UPDATE share_links SET public_until = ? WHERE token = ?').run(Date.now() - 1, a.token);
    expect((await t.anon(`/f/${a.token}`)).status).toBe(410);
    expect((await t.rawRequest('GET', `/f/${a.token}`)).status).toBe(200); // the owner still opens it

    const b = await t.share('files/note <b>.txt');
    rmSync(join(t.ws, 'files', 'note <b>.txt'));
    const gone = await t.rawRequest('GET', `/f/${b.token}`);
    expect(gone.status).toBe(404);
    const html = await gone.text();
    expect(html).toContain('/opt/data/workspace/dev/files/note &#60;b&#62;.txt');
    await t.request('PATCH', `/x/links/${b.token}`, { publicUntil: Date.now() + 60_000 });
    const goneAnon = await t.anon(`/f/${b.token}`);
    expect(goneAnon.status).toBe(404);
    expect(await goneAnon.text()).not.toContain('/opt/data');

    expect((await t.request('DELETE', `/x/links/${a.token}`)).status).toBe(200);
    const revoked = await t.rawRequest('GET', `/f/${a.token}`);
    expect(revoked.status).toBe(404);
    expect(await revoked.text()).toContain('Lien révoqué');
    expect((await t.anon('/f/doesnotexi')).status).toBe(404);
    expect((await t.anon('/f/abc')).status).toBe(404);
  });

  it('PATCH limits: past date, more than 365 days, revoked', async () => {
    const t = await setup();
    const a = await t.share('files/a_b/r.md');
    expect((await t.request('PATCH', `/x/links/${a.token}`, { publicUntil: Date.now() - 1000 })).status).toBe(400);
    expect((await t.request('PATCH', `/x/links/${a.token}`, { publicUntil: Date.now() + 366 * 86_400_000 })).status).toBe(400);
    await t.request('DELETE', `/x/links/${a.token}`);
    expect((await t.request('PATCH', `/x/links/${a.token}`, { publicUntil: null })).status).toBe(409);
  });

  it('moves from the explorer rewrite links by exact prefix', async () => {
    const t = await setup();
    const inA = await t.share('files/a_b/r.md');
    const inX = await t.share('files/axb/r.md');
    expect((await t.request('PATCH', '/x/workspaces/dev/files/move', { from: 'files/a_b', to: 'files/c' })).status).toBe(200);
    expect((await t.request('PATCH', '/x/workspaces/dev/files/move', { from: 'files/c/r.md', to: 'files/c/s.md' })).status).toBe(200);
    // a failed move (target exists) changes no link
    expect((await t.request('PATCH', '/x/workspaces/dev/files/move', { from: 'files/c/s.md', to: 'files/axb/r.md' })).status).toBe(409);
    const list = (await t.request('GET', '/x/links')).json.links;
    const by = (tok: string) => list.find((l: any) => l.token === tok);
    expect(by(inA.token)).toMatchObject({ path: 'dev/files/c/s.md', exists: true, workspace: 'dev', agentPath: '/opt/data/workspace/dev/files/c/s.md' });
    expect(by(inX.token)).toMatchObject({ path: 'dev/files/axb/r.md', exists: true });
    expect((await t.rawRequest('GET', `/f/${inA.token}`)).status).toBe(200);
  });
});
