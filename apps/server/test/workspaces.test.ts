import { lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framingAgentsMd } from '../src/workspaces/fs.js';
import { testApp } from './helpers.js';

describe('workspaces', () => {
  it('counts the non-archived sessions of each workspace', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces', { slug: 'vide', name: 'Vide', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces/dev/sessions');
    const b = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${b.id}`, { archived: true });
    const list = (await t.request('GET', '/x/workspaces')).json.workspaces;
    expect(list.find((w: any) => w.slug === 'dev').sessionCount).toBe(1);
    expect(list.find((w: any) => w.slug === 'vide').sessionCount).toBe(0);
  });

  it('creates the folder tree, AGENTS.md and the row', async () => {
    const t = await testApp();
    const res = await t.request('POST', '/x/workspaces', { slug: 'magasins', name: 'Magasins', instanceId: 'fake', model: 'opus' });
    expect(res.status).toBe(201);
    const dir = join(t.root, 'magasins');
    expect(readdirSync(dir).sort()).toEqual(['AGENTS.md', 'files', 'inbox', 'sessions']);
    // AGENTS.md is written after the mkdirs: the cached listing of the new folder was dropped
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('Consignes du projet');
    expect((await t.request('GET', '/x/workspaces')).json.workspaces).toMatchObject([{ slug: 'magasins', model: null, effort: null, profile: null }]);
    expect((await t.request('GET', '/x/workspaces/magasins/agents-md')).json.text).toContain('Consignes du projet');
  });

  it('rejects invalid slugs', async () => {
    const t = await testApp();
    for (const slug of ['../x', 'A', 'a'.repeat(41), '']) {
      expect((await t.request('POST', '/x/workspaces', { slug, name: 'x', instanceId: 'fake' })).status).toBe(400);
    }
    expect(readdirSync(t.root)).toEqual([]);
  });

  it('never overwrites an existing folder or link', async () => {
    const t = await testApp();
    mkdirSync(join(t.root, 'pris'));
    expect((await t.request('POST', '/x/workspaces', { slug: 'pris', name: 'x', instanceId: 'fake' })).status).toBe(409);
    symlinkSync(join(t.root, 'pris'), join(t.root, 'lien'));
    expect((await t.request('POST', '/x/workspaces', { slug: 'lien', name: 'x', instanceId: 'fake' })).status).toBe(409);
    expect(lstatSync(join(t.root, 'lien')).isSymbolicLink()).toBe(true);
    // a link leaving the root makes the root unreadable: refused, nothing created
    symlinkSync('/tmp', join(t.root, 'dehors'));
    expect((await t.request('POST', '/x/workspaces', { slug: 'neuf', name: 'x', instanceId: 'fake' })).status).toBe(403);
    expect(readdirSync(t.root).sort()).toEqual(['dehors', 'lien', 'pris']);
    expect((await t.request('GET', '/x/workspaces')).json.workspaces).toEqual([]);
  });

  it('without a usable files root: Files module unavailable with the reason, no new workspace (422)', async () => {
    const cases: { name: string; opts: Parameters<typeof testApp>[0]; reason: RegExp }[] = [
      { name: 'no locked root', opts: { breaks: { 'dash GET /api/files': { body: { path: '/root', locked_root: null, entries: [] } } } }, reason: /HERMES_DASHBOARD_FILES_ROOT=\/opt\/data\/workspace/ },
      { name: 'root /', opts: { breaks: { 'dash GET /api/files': { body: { path: '/', locked_root: '/', entries: [] } } } }, reason: /contient sa configuration/ },
      { name: 'root holds hermes_home', opts: { hermesHome: '/opt/data/.hermes', breaks: { 'dash GET /api/files': { body: { path: '/opt/data', locked_root: '/opt/data', entries: [] } } } }, reason: /contient sa configuration/ },
      { name: 'root = hermes_home', opts: { hermesHome: '/opt/data/' , breaks: { 'dash GET /api/files': { body: { path: '/opt/data', locked_root: '/opt/data', entries: [] } } } }, reason: /contient sa configuration/ },
      { name: 'docker terminal', opts: { terminalBackend: 'docker' }, reason: /« docker »/ },
    ];
    for (const c of cases) {
      const t = await testApp(c.opts);
      const report = (await t.request('GET', '/x/compat')).json.reports[0];
      const mod = report.modules.find((m: any) => m.id === 'files');
      expect(mod?.state, c.name).toBe('unavailable');
      expect(mod?.reasons[0], c.name).toMatch(c.reason);
      const inst = (await t.request('GET', '/x/instances')).json.instances[0];
      expect(inst.files, c.name).toMatchObject({ workspaceRoot: null, reason: expect.stringMatching(c.reason) });
      const res = await t.request('POST', '/x/workspaces', { slug: 'x', name: 'x', instanceId: 'fake' });
      expect(res.status, c.name).toBe(422);
      expect((await t.request('GET', '/x/workspaces')).json.workspaces).toEqual([]);
    }
  });

  it('the root of the dashboard is the workspace root; a hermes_home elsewhere is fine', async () => {
    const t = await testApp({ hermesHome: '/opt/data' });
    const inst = (await t.request('GET', '/x/instances')).json.instances[0];
    expect(inst.files).toEqual({ workspaceRoot: t.root, reason: null });
    expect(inst).not.toHaveProperty('mount');
    expect(dirname(t.root)).not.toBe(t.root);
  });

  it('a report saved without files is checked again at the next tick', async () => {
    const t = await testApp();
    const report = t.compat.get('fake')!;
    delete report.files;
    await t.compat.tick();
    expect(t.compat.get('fake')!.files?.workspaceRoot).toBe(t.root);
  });

  it('POST /x/instances/test shows the files root or the reason', async () => {
    const t = await testApp({ terminalBackend: 'ssh' });
    const res = await t.request('POST', '/x/instances/test', { ...t.inst });
    expect(res.json.files).toMatchObject({ workspaceRoot: null, reason: expect.stringContaining('« ssh »') });
  });

  it('removes the folder when the database insert fails', async () => {
    const t = await testApp();
    t.db.$client.exec('CREATE TRIGGER no_ws BEFORE INSERT ON workspaces BEGIN SELECT RAISE(ABORT, \'boom\'); END;');
    expect((await t.request('POST', '/x/workspaces', { slug: 'raté', name: 'x', instanceId: 'fake' })).status).toBe(400);
    expect((await t.request('POST', '/x/workspaces', { slug: 'rate', name: 'x', instanceId: 'fake' })).status).toBe(500);
    expect(readdirSync(t.root)).toEqual([]);
  });

  it('only accepts profiles that have a key', async () => {
    const t = await testApp({ profileKeys: { dev: 'dev-profile-key-0000000' } });
    expect((await t.request('POST', '/x/workspaces', { slug: 'a', name: 'a', instanceId: 'fake', profile: 'autre' })).status).toBe(400);
    expect((await t.request('POST', '/x/workspaces', { slug: 'b', name: 'b', instanceId: 'fake', profile: 'dev' })).status).toBe(201);
  });

  it('edits AGENTS.md up to 64 KiB', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'w', name: 'W', instanceId: 'fake' });
    expect((await t.request('PUT', '/x/workspaces/w/agents-md', { text: 'Réponds en français.' })).status).toBe(200);
    expect(readFileSync(join(t.root, 'w', 'AGENTS.md'), 'utf8')).toBe('Réponds en français.');
    expect((await t.request('PUT', '/x/workspaces/w/agents-md', { text: 'é'.repeat(40_000) })).status).toBe(413);
  });

  it('updates the name; the model is no longer a workspace setting', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'w', name: 'W', instanceId: 'fake' });
    const res = await t.request('PATCH', '/x/workspaces/w', { name: 'Dev', model: 'sonnet' });
    expect(res.json.workspace).toMatchObject({ name: 'Dev', model: null });
  });
});

describe('framingAgentsMd', () => {
  it('keeps short files and cuts long ones on a character boundary', () => {
    expect(framingAgentsMd('court\n', '/w/x')).toBe('court');
    const long = 'é'.repeat(3000); // 6000 bytes
    const out = framingAgentsMd(long, '/w/x');
    const [body, tail] = out.split('\n');
    expect(Buffer.byteLength(body!, 'utf8')).toBeLessThanOrEqual(4096);
    expect(body).toMatch(/^é+$/);
    expect(tail).toBe('(suite tronquée : lis /w/x/AGENTS.md en entier avant de commencer)');
  });
});
