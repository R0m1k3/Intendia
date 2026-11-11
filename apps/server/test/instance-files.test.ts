import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileRoots, FsEntry } from '../src/files/hermes-fs.js';
import { InstanceFileService } from '../src/files/instance-files.js';
import type { InstanceStore } from '../src/instances/store.js';
import type { WorkspaceService } from '../src/workspaces/service.js';
import { testApp } from './helpers.js';

async function setup() {
  const t = await testApp();
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  mkdirSync(join(t.root, 'crons', 'veille'), { recursive: true });
  writeFileSync(join(t.root, 'crons', 'veille', 'rapport.md'), '# Veille');
  mkdirSync(join(t.root, 'Notes agent'));
  writeFileSync(join(t.root, 'Notes agent', 'idées.txt'), 'x');
  writeFileSync(join(t.root, 'dev', '.env'), 'SECRET=1');
  const I = '/x/i/fake/files';
  const q = (p: string) => encodeURIComponent(p);
  return { ...t, I, q };
}

describe('instance files (read only, whole root)', () => {
  it('lists the root: workspaces marked, other folders too', async () => {
    const t = await setup();
    const res = await t.request('GET', `${t.I}/tree`);
    expect(res.status).toBe(200);
    const names = res.json.entries.map((e: any) => e.name);
    expect(names).toEqual(expect.arrayContaining(['crons', 'dev', 'Notes agent']));
    expect(res.json.entries.find((e: any) => e.name === 'dev')).toMatchObject({ kind: 'dir', workspace: 'dev' });
    expect(res.json.entries.find((e: any) => e.name === 'crons').workspace).toBeUndefined();
  });

  it('opens a folder outside the workspaces, whatever its name, and reads a file', async () => {
    const t = await setup();
    const sub = await t.request('GET', `${t.I}/tree?path=${t.q('Notes agent')}`);
    expect(sub.status).toBe(200);
    expect(sub.json.entries[0]).toMatchObject({ name: 'idées.txt', path: 'Notes agent/idées.txt', kind: 'file' });
    expect(sub.json.entries[0].workspace).toBeUndefined();
    const raw = await t.rawRequest('GET', `${t.I}/raw?path=${t.q('crons/veille/rapport.md')}`);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe('# Veille');
  });

  it('searches by name over the whole root', async () => {
    const t = await setup();
    const res = await t.request('GET', `${t.I}/search?q=rapport`);
    expect(res.json.results.map((e: any) => e.path)).toEqual(['crons/veille/rapport.md']);
  });

  it('refuses traversal, hides credentials, unknown instance → 404', async () => {
    const t = await setup();
    for (const p of ['../x', '/etc/passwd', 'a\0b']) expect((await t.request('GET', `${t.I}/raw?path=${t.q(p)}`)).status, p).toBe(400);
    expect((await t.request('GET', `${t.I}/raw?path=dev/.env`)).status).toBe(404);
    expect((await t.request('GET', `${t.I}/tree?path=dev`)).json.entries.map((e: any) => e.name)).not.toContain('.env');
    expect((await t.request('GET', '/x/i/nope/files/tree')).status).toBe(404);
  });

  it('filters credential names itself, even if Hermes listed them', async () => {
    const entry = (name: string): FsEntry => ({ name, vol: name, isDir: false, isLink: false, broken: false, size: 1, mtimeMs: 0 });
    const fs = {
      listAt: async () => ({ entries: [entry('auth.json'), entry('.env.local'), entry('ok.txt')] }),
      readAt: async () => { throw new Error('must not be read'); },
    };
    const svc = new InstanceFileService(
      { get: () => ({}) } as unknown as InstanceStore,
      { fs: () => fs } as unknown as FileRoots,
      { listWorkspaces: () => [] } as unknown as WorkspaceService,
    );
    expect((await svc.list('x', 'a')).entries.map((e) => e.name)).toEqual(['ok.txt']);
    expect((await svc.search('x', 'json')).results).toEqual([]);
    await expect(svc.read('x', 'a/auth.json')).rejects.toMatchObject({ code: 'not_found' });
  });
});
