import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { framingAgentsMd } from '../src/workspaces/fs.js';
import { testApp } from './helpers.js';

const mode = (p: string) => statSync(p).mode & 0o777;

describe('workspaces', () => {
  it('creates the folder tree, AGENTS.md and the row', async () => {
    const t = await testApp();
    const res = await t.request('POST', '/x/workspaces', { slug: 'magasins', name: 'Magasins', instanceId: 'fake', model: 'opus' });
    expect(res.status).toBe(201);
    const dir = join(t.mount, 'magasins');
    expect(readdirSync(dir).sort()).toEqual(['AGENTS.md', 'files', 'inbox', 'sessions']);
    expect(mode(dir)).toBe(0o775);
    expect(mode(join(dir, 'sessions'))).toBe(0o775);
    expect(mode(join(dir, 'AGENTS.md'))).toBe(0o664);
    expect((await t.request('GET', '/x/workspaces')).json.workspaces).toMatchObject([{ slug: 'magasins', model: 'opus', profile: null }]);
    expect((await t.request('GET', '/x/workspaces/magasins/agents-md')).json.text).toContain('Consignes du projet');
  });

  it('rejects invalid slugs', async () => {
    const t = await testApp();
    for (const slug of ['../x', 'A', 'a'.repeat(41), '']) {
      expect((await t.request('POST', '/x/workspaces', { slug, name: 'x', instanceId: 'fake' })).status).toBe(400);
    }
    expect(readdirSync(t.mount)).toEqual([]);
  });

  it('never overwrites an existing folder or link', async () => {
    const t = await testApp();
    mkdirSync(join(t.mount, 'pris'));
    expect((await t.request('POST', '/x/workspaces', { slug: 'pris', name: 'x', instanceId: 'fake' })).status).toBe(409);
    symlinkSync('/tmp', join(t.mount, 'lien'));
    expect((await t.request('POST', '/x/workspaces', { slug: 'lien', name: 'x', instanceId: 'fake' })).status).toBe(409);
    expect(lstatSync(join(t.mount, 'lien')).isSymbolicLink()).toBe(true);
    expect((await t.request('GET', '/x/workspaces')).json.workspaces).toEqual([]);
  });

  it('fails cleanly when the mount is missing', async () => {
    const t = await testApp({ mount: '/nonexistent-intendia-mount' });
    const res = await t.request('POST', '/x/workspaces', { slug: 'x', name: 'x', instanceId: 'fake' });
    expect(res.status).toBe(422);
    expect((await t.request('GET', '/x/workspaces')).json.workspaces).toEqual([]);
  });

  it('removes the folder when the database insert fails', async () => {
    const t = await testApp();
    t.db.$client.exec('CREATE TRIGGER no_ws BEFORE INSERT ON workspaces BEGIN SELECT RAISE(ABORT, \'boom\'); END;');
    expect((await t.request('POST', '/x/workspaces', { slug: 'raté', name: 'x', instanceId: 'fake' })).status).toBe(400);
    expect((await t.request('POST', '/x/workspaces', { slug: 'rate', name: 'x', instanceId: 'fake' })).status).toBe(500);
    expect(readdirSync(t.mount)).toEqual([]);
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
    expect(readFileSync(join(t.mount, 'w', 'AGENTS.md'), 'utf8')).toBe('Réponds en français.');
    expect((await t.request('PUT', '/x/workspaces/w/agents-md', { text: 'é'.repeat(40_000) })).status).toBe(413);
  });

  it('updates name and model', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'w', name: 'W', instanceId: 'fake' });
    const res = await t.request('PATCH', '/x/workspaces/w', { name: 'Dev', model: 'sonnet' });
    expect(res.json.workspace).toMatchObject({ name: 'Dev', model: 'sonnet' });
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
