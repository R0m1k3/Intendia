import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

async function setup(env: Record<string, string> = {}) {
  const t = await testApp({ instance: { agentMount: '/opt/data/workspace' }, env });
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  expect((await t.request('POST', '/x/workspaces', { slug: 'b', name: 'B', instanceId: 'fake' })).status).toBe(201);
  const ws = join(t.mount, 'dev');
  mkdirSync(join(ws, 'files', 'sub'));
  writeFileSync(join(ws, 'files', 'sub', 'a.txt'), 'a');
  writeFileSync(join(ws, 'files', 'Rapport été.md'), '# R');
  writeFileSync(join(ws, 'files', 'doc.pdf'), '%PDF-1.4');
  symlinkSync('/etc', join(ws, 'files', 'out'));
  symlinkSync(join(ws, 'files', 'sub'), join(ws, 'files', 'ok'));
  const F = '/x/workspaces/dev/files';
  const q = (p: string) => encodeURIComponent(p);
  return { ...t, ws, F, q };
}

describe('path guard on routes', () => {
  it('refuses traversal with 400 and outward links with 403', async () => {
    const t = await setup();
    for (const p of ['../b/AGENTS.md', 'files/../../x', '/etc/passwd', 'a\0b', 'x'.repeat(1025)]) {
      expect((await t.request('GET', `${t.F}/raw?path=${t.q(p)}`)).status, p).toBe(400);
    }
    expect((await t.request('GET', `${t.F}/tree?path=files/out`)).status).toBe(403);
    expect((await t.request('GET', `${t.F}/raw?path=files/out/passwd`)).status).toBe(403);
    expect((await t.rawRequest('PUT', `${t.F}/upload?dir=files/out&name=x.txt`, { body: 'x' })).status).toBe(403);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'files/out/x' })).status).toBe(403);
    expect((await t.request('DELETE', `${t.F}?path=files/out/passwd`)).status).toBe(403);
    const tree = (await t.request('GET', `${t.F}/tree?path=files`)).json;
    expect(tree.entries.find((e: any) => e.name === 'out')).toMatchObject({ kind: 'link', outside: true });
    expect(tree.entries.find((e: any) => e.name === 'ok')).toMatchObject({ kind: 'link', target: 'dir' });
    expect((await t.request('GET', `${t.F}/raw?path=files/ok/a.txt`)).status).toBe(200);
  });

  it('does not write through a dangling link', async () => {
    const t = await setup();
    symlinkSync(join(t.ws, 'nowhere.txt'), join(t.ws, 'inbox', 'x.txt'));
    const res = await t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=x.txt`, { body: 'x' });
    expect(res.status).toBe(201);
    expect((await res.json()).path).toBe('inbox/x (2).txt');
    expect(existsSync(join(t.ws, 'nowhere.txt'))).toBe(false);
  });

  it('exists: other workspaces give null', async () => {
    const t = await setup();
    const r = (await t.request('POST', `${t.F}/exists`, {
      paths: ['/opt/data/workspace/dev/files/doc.pdf', `${t.mount}/dev/files/sub`, 'files/sub/a.txt', '/opt/data/workspace/b/AGENTS.md', 'files/none', '../b/AGENTS.md'],
    })).json.results;
    expect(r['/opt/data/workspace/dev/files/doc.pdf']).toEqual({ path: 'files/doc.pdf', kind: 'file' });
    expect(r[`${t.mount}/dev/files/sub`]).toEqual({ path: 'files/sub', kind: 'dir' });
    expect(r['files/sub/a.txt']).toEqual({ path: 'files/sub/a.txt', kind: 'file' });
    expect(r['/opt/data/workspace/b/AGENTS.md']).toBeNull();
    expect(r['files/none']).toBeNull();
    expect(r['../b/AGENTS.md']).toBeNull();
  });

  it('auth: 401 without session, 403 without X-Intendia on writes', async () => {
    const t = await setup();
    expect((await t.rawRequest('GET', `${t.F}/tree`, { cookie: false })).status).toBe(401);
    expect((await t.rawRequest('GET', `${t.F}/raw?path=files/doc.pdf`, { cookie: false })).status).toBe(401);
    expect((await t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=a`, { body: 'a', csrf: false })).status).toBe(403);
    expect((await t.rawRequest('DELETE', `${t.F}?path=files/doc.pdf`, { csrf: false })).status).toBe(403);
  });
});

describe('files', () => {
  it('tree sorts folders first, search folds case and accents and skips node_modules', async () => {
    const t = await setup();
    const root = (await t.request('GET', `${t.F}/tree`)).json;
    expect(root.entries.map((e: any) => e.name)).toEqual(['files', 'inbox', 'sessions', 'AGENTS.md']);
    mkdirSync(join(t.ws, 'node_modules', 'rapport'), { recursive: true });
    const s = (await t.request('GET', `${t.F}/search?q=RAPPORT ETE`)).json;
    expect(s.results.map((e: any) => e.path)).toEqual(['files/Rapport été.md']);
    const s2 = (await t.request('GET', `${t.F}/search?q=a.txt`)).json;
    expect(s2.results.map((e: any) => e.path)).toEqual(['files/sub/a.txt']); // not through the "ok" link
  });

  it('tree is cut at 2000 entries', async () => {
    const t = await setup();
    mkdirSync(join(t.ws, 'files', 'many'));
    for (let i = 0; i < 2001; i++) writeFileSync(join(t.ws, 'files', 'many', `f${i}`), '');
    const r = (await t.request('GET', `${t.F}/tree?path=files/many`)).json;
    expect(r.entries).toHaveLength(2000);
    expect(r.truncated).toBe(true);
  });

  it('upload: stream, shared mode, collision suffix, invalid name, size limit', async () => {
    const t = await setup({ INTENDIA_UPLOAD_MAX_MB: '1' });
    const up = (name: string, body: Buffer | string) => t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=${encodeURIComponent(name)}`, { body });
    const r1 = await up('note.txt', 'bonjour');
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ path: 'inbox/note.txt', agentPath: '/opt/data/workspace/dev/inbox/note.txt' });
    expect(statSync(join(t.ws, 'inbox', 'note.txt')).mode & 0o777).toBe(0o664);
    expect((await (await up('note.txt', 'x')).json()).path).toBe('inbox/note (2).txt');
    expect((await up('a/b', 'x')).status).toBe(400);
    expect((await up('..', 'x')).status).toBe(400);
    const big = await up('big.bin', Buffer.alloc(1024 * 1024 + 10));
    expect(big.status).toBe(413);
    expect(existsSync(join(t.ws, 'inbox', 'big.bin'))).toBe(false);
  });

  it('two concurrent uploads of the same name both land, under two names', async () => {
    const t = await setup();
    const up = (body: string) => t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=same.txt`, { body });
    const res = await Promise.all([up('un'), up('deux'), up('trois')]);
    expect(res.map((r) => r.status)).toEqual([201, 201, 201]);
    const paths = (await Promise.all(res.map((r) => r.json()))).map((j: { path: string }) => j.path).sort();
    expect(paths).toEqual(['inbox/same (2).txt', 'inbox/same (3).txt', 'inbox/same.txt']);
    const bodies = paths.map((p) => readFileSync(join(t.ws, p), 'utf8')).sort();
    expect(bodies).toEqual(['deux', 'trois', 'un']);
  });

  it('move never overwrites; delete protects the standard folders', async () => {
    const t = await setup();
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'files/sub/doc.pdf' })).status).toBe(200);
    expect(existsSync(join(t.ws, 'files', 'sub', 'doc.pdf'))).toBe(true);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/sub/doc.pdf', to: 'files/sub/a.txt' })).status).toBe(409);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files', to: 'files/x' })).status).toBe(400);
    for (const p of ['inbox', 'AGENTS.md', 'sessions', 'files', '']) {
      expect((await t.request('DELETE', `${t.F}?path=${p}`)).status, p).toBe(400);
    }
    expect((await t.request('DELETE', `${t.F}?path=files/sub`)).status).toBe(200);
    expect(existsSync(join(t.ws, 'files', 'sub'))).toBe(false);
    expect((await t.request('DELETE', `${t.F}?path=files/out`)).status).toBe(200); // removes the link, not /etc
    expect(existsSync('/etc/passwd')).toBe(true);
  });

  it('text: save, stale mtime, size limit', async () => {
    const t = await setup();
    const tree = (await t.request('GET', `${t.F}/tree?path=files`)).json;
    const md = tree.entries.find((e: any) => e.name === 'Rapport été.md');
    const ok = await t.request('PUT', `${t.F}/text`, { path: md.path, text: '# R2', mtime: md.mtime });
    expect(ok.status).toBe(200);
    expect(readFileSync(join(t.ws, md.path), 'utf8')).toBe('# R2');
    expect((await t.request('PUT', `${t.F}/text`, { path: md.path, text: '# R3', mtime: md.mtime - 5000 })).status).toBe(409);
    expect((await t.request('PUT', `${t.F}/text`, { path: md.path, text: 'x'.repeat(1024 * 1024 + 1), mtime: ok.json.mtime })).status).toBe(413);
  });

  it('raw: sandbox, framing by Intendia only, type from the extension, download', async () => {
    const t = await setup();
    const res = await t.rawRequest('GET', `${t.F}/raw?path=files/doc.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline/);
    const dl = await t.rawRequest('GET', `${t.F}/raw?path=${t.q('files/Rapport été.md')}&download=1`);
    expect(dl.headers.get('content-disposition')).toContain("attachment; filename=\"Rapport _t_.md\"; filename*=UTF-8''Rapport%20%C3%A9t%C3%A9.md");
    expect(await dl.text()).toBe('# R');
    expect((await t.rawRequest('GET', '/x/workspaces')).headers.get('x-frame-options')).toBe('DENY');
  });
});

