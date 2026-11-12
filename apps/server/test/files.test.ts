import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_CSP } from '../src/files/send.js';
import { tempDir, testApp } from './helpers.js';

async function setup(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  expect((await t.request('POST', '/x/workspaces', { slug: 'b', name: 'B', instanceId: 'fake' })).status).toBe(201);
  const ws = join(t.root, 'dev');
  mkdirSync(join(ws, 'files', 'sub'));
  writeFileSync(join(ws, 'files', 'sub', 'a.txt'), 'a');
  writeFileSync(join(ws, 'files', 'Rapport été.md'), '# R');
  writeFileSync(join(ws, 'files', 'doc.pdf'), '%PDF-1.4');
  symlinkSync(join(ws, 'files', 'sub'), join(ws, 'files', 'ok'));
  const F = '/x/workspaces/dev/files';
  const q = (p: string) => encodeURIComponent(p);
  return { ...t, ws, F, q };
}

describe('path guard on routes', () => {
  it('refuses traversal with 400', async () => {
    const t = await setup();
    for (const p of ['../b/AGENTS.md', 'files/../../x', '/etc/passwd', 'a\0b', 'x'.repeat(1025)]) {
      expect((await t.request('GET', `${t.F}/raw?path=${t.q(p)}`)).status, p).toBe(400);
    }
  });

  it('a link leaving the root makes its folder unreadable (403 with the reason), the rest stays usable', async () => {
    const t = await setup();
    mkdirSync(join(t.ws, 'files', 'danger'));
    symlinkSync('/etc', join(t.ws, 'files', 'danger', 'out'));
    const res = await t.request('GET', `${t.F}/tree?path=files/danger`);
    expect(res.status).toBe(403);
    expect(res.json.error).toContain("sort de la racine d'Hermes");
    expect((await t.request('GET', `${t.F}/raw?path=files/danger/out/passwd`)).status).toBe(403);
    expect((await t.request('GET', `${t.F}/tree?path=files`)).status).toBe(200);
  });

  it('links inside the root: listed as links, readable, never written, moved nor deleted', async () => {
    const t = await setup();
    symlinkSync(join(t.ws, 'files', 'doc.pdf'), join(t.ws, 'a.pdf'));
    const tree = (await t.request('GET', `${t.F}/tree?path=files`)).json;
    expect(tree.entries.find((e: any) => e.name === 'ok')).toMatchObject({ kind: 'link', outside: true });
    expect((await t.request('GET', `${t.F}/raw?path=files/ok/a.txt`)).status).toBe(200);
    expect((await t.request('DELETE', `${t.F}?path=a.pdf`)).status).toBe(403);
    expect((await t.request('DELETE', `${t.F}?path=files/ok`)).status).toBe(403);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'a.pdf', to: 'files/b.pdf' })).status).toBe(403);
    const root = (await t.request('GET', `${t.F}/tree`)).json.entries.find((e: any) => e.name === 'a.pdf');
    expect((await t.request('PUT', `${t.F}/text`, { path: 'a.pdf', text: 'x', mtime: root.mtime })).status).toBe(403);
    expect(readFileSync(join(t.ws, 'files', 'doc.pdf'), 'utf8')).toBe('%PDF-1.4');
    expect(existsSync(join(t.ws, 'files', 'sub', 'a.txt'))).toBe(true);
  });

  it('a folder reached through a link: its files are not links', async () => {
    const t = await setup();
    const tree = (await t.request('GET', `${t.F}/tree?path=files/ok`)).json;
    expect(tree.entries).toEqual([expect.objectContaining({ name: 'a.txt', kind: 'file', path: 'files/ok/a.txt' })]);
  });

  it('never writes through a broken link, even one pointing outside the root', async () => {
    const t = await setup();
    const outside = tempDir();
    symlinkSync(join(outside, 'x.txt'), join(t.ws, 'inbox', 'x.txt'));
    const tree = (await t.request('GET', `${t.F}/tree?path=inbox`)).json;
    expect(tree.entries).toEqual([expect.objectContaining({ name: 'x.txt', kind: 'link' })]);
    const res = await t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=x.txt`, { body: 'x' });
    expect(res.status).toBe(201);
    expect((await res.json()).path).toBe('inbox/x (2).txt');
    expect((await t.request('PUT', `${t.F}/text`, { path: 'inbox/x.txt', text: 'x', mtime: 0 })).status).toBe(403);
    expect((await t.request('DELETE', `${t.F}?path=inbox/x.txt`)).status).toBe(403);
    expect(existsSync(join(outside, 'x.txt'))).toBe(false);
  });

  it('exists: other workspaces and paths outside the root give null', async () => {
    const t = await setup();
    const r = (await t.request('POST', `${t.F}/exists`, {
      paths: [`${t.root}/dev/files/doc.pdf`, `${t.root}/dev/files/sub`, 'files/sub/a.txt', `${t.root}/b/AGENTS.md`, 'files/none', '../b/AGENTS.md', '/opt/data/workspace/dev/files/doc.pdf'],
    })).json.results;
    expect(r[`${t.root}/dev/files/doc.pdf`]).toEqual({ path: 'files/doc.pdf', kind: 'file' });
    expect(r[`${t.root}/dev/files/sub`]).toEqual({ path: 'files/sub', kind: 'dir' });
    expect(r['files/sub/a.txt']).toEqual({ path: 'files/sub/a.txt', kind: 'file' });
    expect(r[`${t.root}/b/AGENTS.md`]).toBeNull();
    expect(r['files/none']).toBeNull();
    expect(r['../b/AGENTS.md']).toBeNull();
    expect(r['/opt/data/workspace/dev/files/doc.pdf']).toBeNull();
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
  it('tree sorts folders first, search folds case and accents and skips node_modules and links', async () => {
    const t = await setup();
    const root = (await t.request('GET', `${t.F}/tree`)).json;
    expect(root.entries.map((e: any) => e.name)).toEqual(['files', 'inbox', 'sessions', 'AGENTS.md']);
    mkdirSync(join(t.ws, 'node_modules', 'rapport'), { recursive: true });
    const s = (await t.request('GET', `${t.F}/search?q=RAPPORT ETE`)).json;
    expect(s.results.map((e: any) => e.path)).toEqual(['files/Rapport été.md']);
    const s2 = (await t.request('GET', `${t.F}/search?q=a.txt`)).json;
    expect(s2.results.map((e: any) => e.path)).toEqual(['files/sub/a.txt']); // not through the "ok" link
  });

  it('names hidden by Hermes are not listed', async () => {
    const t = await setup();
    writeFileSync(join(t.ws, 'files', '.env'), 'SECRET=1');
    const tree = (await t.request('GET', `${t.F}/tree?path=files`)).json;
    expect(tree.entries.map((e: any) => e.name)).not.toContain('.env');
    // never written: an existing one stays as it is, a new one is not created (it could not be seen again)
    for (const name of ['.env', 'config.yaml', '.env.local']) {
      const res = await t.rawRequest('PUT', `${t.F}/upload?dir=files&name=${name}`, { body: 'x' });
      expect(res.status, name).toBe(400);
    }
    expect(readFileSync(join(t.ws, 'files', '.env'), 'utf8')).toBe('SECRET=1');
    expect(existsSync(join(t.ws, 'files', 'config.yaml'))).toBe(false);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'files/auth.json' })).status).toBe(400);
    expect(existsSync(join(t.ws, 'files', 'doc.pdf'))).toBe(true);
  });

  it('tree is cut at 2000 entries', async () => {
    const t = await setup();
    mkdirSync(join(t.ws, 'files', 'many'));
    for (let i = 0; i < 2001; i++) writeFileSync(join(t.ws, 'files', 'many', `f${i}`), '');
    const r = (await t.request('GET', `${t.F}/tree?path=files/many`)).json;
    expect(r.entries).toHaveLength(2000);
    expect(r.truncated).toBe(true);
  });

  it('upload: stream, collision suffix, invalid name, size limit', async () => {
    const t = await setup({ env: { INTENDIA_UPLOAD_MAX_MB: '1' } });
    const up = (name: string, body: Buffer | string) => t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=${encodeURIComponent(name)}`, { body });
    const r1 = await up('note.txt', 'bonjour');
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ path: 'inbox/note.txt', agentPath: `${t.root}/dev/inbox/note.txt` });
    expect(readFileSync(join(t.ws, 'inbox', 'note.txt'), 'utf8')).toBe('bonjour');
    expect((await (await up('note.txt', 'x')).json()).path).toBe('inbox/note (2).txt');
    expect((await up('a/b', 'x')).status).toBe(400);
    expect((await up('..', 'x')).status).toBe(400);
    const big = await up('big.bin', Buffer.alloc(1024 * 1024 + 10));
    expect(big.status).toBe(413);
    expect(existsSync(join(t.ws, 'inbox', 'big.bin'))).toBe(false);
  });

  it('upload: a missing folder (workspace made before 0.0.4) is created, the whole workspace folder too', async () => {
    const t = await setup();
    rmSync(t.ws, { recursive: true, force: true });
    const res = await t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=collage.png`, { body: 'png' });
    expect(res.status).toBe(201);
    expect(readFileSync(join(t.ws, 'inbox', 'collage.png'), 'utf8')).toBe('png');
  });

  it('extract: zip unpacked next to it in a free folder, hidden names skipped, one at a time, sizes', async () => {
    const t = await setup({ env: { INTENDIA_UPLOAD_MAX_MB: '1' } });
    const { zipSync } = await import('fflate');
    const enc = new TextEncoder();
    const zip = zipSync({ 'notes/a.md': enc.encode('# A'), 'b.txt': enc.encode('B'), '.env': enc.encode('SECRET=1'), '../x': enc.encode('x') });
    mkdirSync(join(t.ws, 'inbox', 'Lot'), { recursive: true });
    writeFileSync(join(t.ws, 'inbox', 'Lot.zip'), zip);
    const ex = (path: string) => t.request('POST', `${t.F}/extract`, { path });
    const [a, b] = await Promise.all([ex('inbox/Lot.zip'), ex('inbox/Lot.zip')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const ok = a.status === 201 ? a : b;
    expect((a.status === 409 ? a : b).json.code).toBe('busy');
    expect(ok.json).toMatchObject({ folder: 'inbox/Lot (2)', count: 2, partial: false });
    expect(ok.json.skipped.map((s: any) => s.reason).sort()).toEqual(['chemin hors du dossier', 'nom caché par Hermes']);
    expect(readFileSync(join(t.ws, 'inbox', 'Lot (2)', 'notes', 'a.md'), 'utf8')).toBe('# A');
    expect(existsSync(join(t.ws, 'inbox', 'Lot (2)', '.env'))).toBe(false);
    expect((await ex('inbox/Lot.zip')).json.folder).toBe('inbox/Lot (3)');

    writeFileSync(join(t.ws, 'inbox', 'faux.zip'), 'pas une archive');
    expect(await ex('inbox/faux.zip')).toMatchObject({ status: 400, json: { code: 'invalid_archive' } });
    expect((await ex('inbox/doc.pdf')).status).toBe(400);
    expect((await ex('inbox/absent.zip')).status).toBe(404);
    writeFileSync(join(t.ws, 'inbox', 'gros.zip'), zipSync({ 'big.bin': new Uint8Array(1024 * 1024 + 1) }));
    expect(await ex('inbox/gros.zip')).toMatchObject({ status: 413, json: { code: 'too_big' } });
    expect(existsSync(join(t.ws, 'inbox', 'gros'))).toBe(false);
  });

  it('INTENDIA_UPLOAD_MAX_MB is capped at 100 (Hermes refuses more)', async () => {
    await expect(testApp({ env: { INTENDIA_UPLOAD_MAX_MB: '200' } })).rejects.toThrow(/INTENDIA_UPLOAD_MAX_MB/);
  });

  it('a slow Hermes does not cut an upload before the upload delay', async () => {
    const t = await setup({ uploadTimeoutMs: 400 });
    t.fake.files.delayMs = 250; // above the 15 s default of other calls would be too slow for a test: only the upload delay is checked
    const res = await t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=lent.txt`, { body: 'lent' });
    expect(res.status).toBe(201);
    t.fake.files.delayMs = 600;
    const cut = await t.rawRequest('PUT', `${t.F}/upload?dir=inbox&name=lent2.txt`, { body: 'lent' });
    expect(cut.status).toBe(502);
    expect((await cut.json()).error).toBe('Hermes injoignable');
  });

  it('move: a file is copied then deleted, never overwrites', async () => {
    const t = await setup();
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'files/sub/doc.pdf' })).status).toBe(200);
    expect(readFileSync(join(t.ws, 'files', 'sub', 'doc.pdf'), 'utf8')).toBe('%PDF-1.4');
    expect(existsSync(join(t.ws, 'files', 'doc.pdf'))).toBe(false);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/sub/doc.pdf', to: 'files/sub/a.txt' })).status).toBe(409);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files', to: 'files/x' })).status).toBe(400);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/sub/a.txt', to: 'nowhere/a.txt' })).status).toBe(404);
  });

  it('zip: a folder as a stream, root named after the workspace, links left out, limits before any byte', async () => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const t = await setup();
    mkdirSync(join(t.ws, 'files', 'Été 2026', 'vide'), { recursive: true });
    writeFileSync(join(t.ws, 'files', 'Été 2026', 'r.md'), '# r');
    const res = await t.rawRequest('GET', `${t.F}/zip?path=${t.q('files/Été 2026')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="_t_ 2026.zip"; filename*=UTF-8''${encodeURIComponent('Été 2026.zip')}`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['Été 2026/r.md', 'Été 2026/vide/']);
    const root = await t.rawRequest('GET', `${t.F}/zip`);
    expect(root.headers.get('content-disposition')).toContain('filename="dev.zip"');
    const all = Object.keys(unzipSync(new Uint8Array(await root.arrayBuffer())));
    expect(all).toContain('dev/files/sub/a.txt');
    expect(all.some((n) => n.startsWith('dev/files/ok'))).toBe(false); // the link
    expect((await t.rawRequest('GET', `${t.F}/zip?path=files/doc.pdf`)).status).toBe(400);
    expect((await t.rawRequest('GET', `${t.F}/zip?path=nowhere`)).status).toBe(404);
    expect(strFromU8(files['Été 2026/r.md']!)).toBe('# r');
  });

  it('zip: past 5 000 files → 413 before any byte', async () => {
    const t = await setup();
    mkdirSync(join(t.ws, 'files', 'beaucoup'));
    for (let i = 0; i <= 5000; i++) writeFileSync(join(t.ws, 'files', 'beaucoup', `${i}.txt`), '');
    const res = await t.request('GET', `${t.F}/zip?path=files/beaucoup`);
    expect(res.status).toBe(413);
    expect(res.json.error).toContain('trop gros pour un zip');
  });

  it('new: an empty file or folder, never over an existing one, reserved names refused', async () => {
    const t = await setup();
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/notes.md', kind: 'file' })).json).toEqual({ path: 'files/notes.md' });
    expect(readFileSync(join(t.ws, 'files', 'notes.md'), 'utf8')).toBe('');
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/rapports', kind: 'dir' })).status).toBe(201);
    expect(existsSync(join(t.ws, 'files', 'rapports'))).toBe(true);
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/notes.md', kind: 'file' })).status).toBe(409);
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/rapports', kind: 'dir' })).status).toBe(409);
    expect((await t.request('POST', `${t.F}/new`, { path: 'nowhere/x.md', kind: 'file' })).status).toBe(404);
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/doc.pdf/x.md', kind: 'file' })).status).toBe(404);
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/auth.json', kind: 'file' })).status).toBe(400);
    expect((await t.request('POST', `${t.F}/new`, { path: 'files/..', kind: 'file' })).status).toBe(400);
    rmSync(join(t.ws, 'inbox'), { recursive: true, force: true });
    expect((await t.request('POST', `${t.F}/new`, { path: 'inbox', kind: 'dir' })).status).toBe(400);
    expect((await t.request('POST', `${t.F}/new`, { path: 'x', kind: 'link' })).status).toBe(400);
  });

  it('move a folder: copied with its empty folders, source deleted, links of inner files follow', async () => {
    const t = await setup();
    mkdirSync(join(t.ws, 'files', 'sub', 'vide'));
    writeFileSync(join(t.ws, 'files', 'sub', 'b.md'), 'bb');
    const link = (await t.request('POST', `${t.F}/share`, { path: 'files/sub/b.md' })).json;
    const res = await t.request('PATCH', `${t.F}/move`, { from: 'files/sub', to: 'inbox/sub' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ path: 'inbox/sub' });
    expect(readFileSync(join(t.ws, 'inbox', 'sub', 'a.txt'), 'utf8')).toBe('a');
    expect(readFileSync(join(t.ws, 'inbox', 'sub', 'b.md'), 'utf8')).toBe('bb');
    expect(existsSync(join(t.ws, 'inbox', 'sub', 'vide'))).toBe(true);
    expect(existsSync(join(t.ws, 'files', 'sub'))).toBe(false);
    expect((await t.request('GET', '/x/links')).json.links.find((l: any) => l.token === link.token).path).toBe('dev/inbox/sub/b.md');
    mkdirSync(join(t.ws, 'files', 'autre'));
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/autre', to: 'inbox/sub' })).status).toBe(409);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'inbox/sub', to: 'inbox/sub/x' })).status).toBe(400);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/autre', to: 'inbox' })).status).toBe(400);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/autre', to: 'sessions' })).status).toBe(400);
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'AGENTS.md' })).status).toBe(400);
    // a name Hermes hides (not listed, so not seen as taken) is refused before anything is written
    writeFileSync(join(t.ws, 'files', '.env'), 'GARDER=1');
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/autre', to: 'files/.env' })).status).toBe(400);
    expect(readFileSync(join(t.ws, 'files', '.env'), 'utf8')).toBe('GARDER=1');
  });

  it('move a folder: a link inside → 403, too many files → 413, nothing written', async () => {
    const t = await setup({ fileOpts: { moveMaxFiles: 2 } });
    mkdirSync(join(t.ws, 'files', 'l'));
    symlinkSync(join(t.ws, 'files', 'doc.pdf'), join(t.ws, 'files', 'l', 'x.pdf'));
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/l', to: 'inbox/l' })).status).toBe(403);
    expect(existsSync(join(t.ws, 'inbox', 'l'))).toBe(false);
    for (const n of ['b', 'c']) writeFileSync(join(t.ws, 'files', 'sub', `${n}.txt`), n);
    const res = await t.request('PATCH', `${t.F}/move`, { from: 'files/sub', to: 'inbox/sub' });
    expect(res.status).toBe(413);
    expect(res.json.error).toContain('trop gros pour être déplacé');
    expect(existsSync(join(t.ws, 'inbox', 'sub'))).toBe(false);
  });

  it('move a folder: a file changed during the copy → 409, copy removed, source intact', async () => {
    const t = await setup({ fileOpts: { afterCopy: async () => writeFileSync(join(ws, 'files', 'sub', 'a.txt'), 'changé') } });
    const ws = t.ws;
    const res = await t.request('PATCH', `${t.F}/move`, { from: 'files/sub', to: 'inbox/sub' });
    expect(res.status).toBe(409);
    expect(res.json.error).toContain('a changé pendant le déplacement');
    expect(existsSync(join(t.ws, 'inbox', 'sub'))).toBe(false);
    expect(readFileSync(join(t.ws, 'files', 'sub', 'a.txt'), 'utf8')).toBe('changé');
  });

  it('move a folder: dropping a failed copy only removes what the move wrote', async () => {
    let t: Awaited<ReturnType<typeof setup>>;
    // a folder of the same name shows up during the copy, with a file of its own: kept
    t = await setup({ fileOpts: { afterCopy: async () => { writeFileSync(join(t.ws, 'inbox', 'sub', 'autre.txt'), 'x'); writeFileSync(join(t.ws, 'files', 'sub', 'a.txt'), 'changé'); } } });
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/sub', to: 'inbox/sub' })).status).toBe(409);
    expect(readFileSync(join(t.ws, 'inbox', 'sub', 'autre.txt'), 'utf8')).toBe('x');
    expect(existsSync(join(t.ws, 'inbox', 'sub', 'a.txt'))).toBe(false);
  });

  it('move a folder: files Hermes hides or added after the check stay, their folder in leftover', async () => {
    let added = false;
    const t = await setup({ fileOpts: { afterCopy: async () => undefined } });
    writeFileSync(join(t.ws, 'files', 'sub', '.env'), 'SECRET=1');
    mkdirSync(join(t.ws, 'files', 'sub', 'deep'));
    writeFileSync(join(t.ws, 'files', 'sub', 'deep', 'd.txt'), 'd');
    const handle = t.fake.files.handle.bind(t.fake.files);
    t.fake.files.handle = async (method, path, req, query) => {
      // first delete of a file: a new file shows up in deep/
      if (method === 'DELETE' && !added) {
        added = true;
        writeFileSync(join(t.ws, 'files', 'sub', 'deep', 'nouveau.txt'), 'n');
      }
      return handle(method, path, req, query);
    };
    const res = await t.request('PATCH', `${t.F}/move`, { from: 'files/sub', to: 'inbox/sub' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ path: 'inbox/sub', leftover: ['files/sub/deep'] });
    expect(readFileSync(join(t.ws, 'files', 'sub', '.env'), 'utf8')).toBe('SECRET=1');
    expect(existsSync(join(t.ws, 'files', 'sub', 'deep', 'nouveau.txt'))).toBe(true);
    expect(existsSync(join(t.ws, 'files', 'sub', 'a.txt'))).toBe(false);
    expect(existsSync(join(t.ws, 'files', 'sub', 'deep', 'd.txt'))).toBe(false);
    expect(readFileSync(join(t.ws, 'inbox', 'sub', 'deep', 'd.txt'), 'utf8')).toBe('d');
  });

  it('move: a source changed during the copy is kept, the copy removed, links untouched', async () => {
    const t = await setup();
    const link = (await t.request('POST', `${t.F}/share`, { path: 'files/doc.pdf' })).json;
    const handle = t.fake.files.handle.bind(t.fake.files);
    t.fake.files.handle = async (method, path, req, query) => {
      if (path === '/api/files/upload-stream') writeFileSync(join(t.ws, 'files', 'doc.pdf'), '%PDF-1.7 plus récent');
      return handle(method, path, req, query);
    };
    const res = await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'files/sub/doc.pdf' });
    expect(res.status).toBe(409);
    expect(res.json.error).toContain('a changé pendant le déplacement');
    expect(readFileSync(join(t.ws, 'files', 'doc.pdf'), 'utf8')).toBe('%PDF-1.7 plus récent');
    expect(existsSync(join(t.ws, 'files', 'sub', 'doc.pdf'))).toBe(false);
    expect((await t.request('GET', '/x/links')).json.links.find((l: any) => l.id === link.id)?.path).toContain('files/doc.pdf');
  });

  it('move: share links follow the file; a failed delete keeps the copy and the links on it', async () => {
    const t = await setup();
    const link = (await t.request('POST', `${t.F}/share`, { path: 'files/doc.pdf' })).json;
    expect((await t.request('PATCH', `${t.F}/move`, { from: 'files/doc.pdf', to: 'inbox/doc.pdf' })).status).toBe(200);
    const after = (await t.request('GET', '/x/links')).json.links.find((l: any) => l.token === link.token);
    expect(after).toMatchObject({ path: 'dev/inbox/doc.pdf', exists: true });

    const breaks: Record<string, { status: number }> = {};
    const t2 = await setup({ breaks });
    breaks['dash DELETE /api/files'] = { status: 500 };
    const l2 = (await t2.request('POST', `${t2.F}/share`, { path: 'files/doc.pdf' })).json;
    const res = await t2.request('PATCH', `${t2.F}/move`, { from: 'files/doc.pdf', to: 'inbox/doc.pdf' });
    expect(res.status).toBe(502);
    expect(res.json.error).toContain('en double');
    expect(existsSync(join(t2.ws, 'files', 'doc.pdf'))).toBe(true);
    expect(existsSync(join(t2.ws, 'inbox', 'doc.pdf'))).toBe(true);
    expect((await t2.request('GET', '/x/links')).json.links.find((l: any) => l.token === l2.token).path).toBe('dev/inbox/doc.pdf');
  });

  it('delete protects the standard folders and removes folders recursively', async () => {
    const t = await setup();
    for (const p of ['inbox', 'AGENTS.md', 'sessions', 'files', '']) {
      expect((await t.request('DELETE', `${t.F}?path=${p}`)).status, p).toBe(400);
    }
    expect((await t.request('DELETE', `${t.F}?path=files/sub`)).status).toBe(200);
    expect(existsSync(join(t.ws, 'files', 'sub'))).toBe(false);
    expect((await t.request('DELETE', `${t.F}?path=files/none`)).status).toBe(404);
  });

  it('text: save, stale mtime, size limit', async () => {
    const t = await setup();
    const tree = (await t.request('GET', `${t.F}/tree?path=files`)).json;
    const md = tree.entries.find((e: any) => e.name === 'Rapport été.md');
    const ok = await t.request('PUT', `${t.F}/text`, { path: md.path, text: '# R2', mtime: md.mtime });
    expect(ok.status).toBe(200);
    expect(typeof ok.json.mtime).toBe('number');
    expect(readFileSync(join(t.ws, md.path), 'utf8')).toBe('# R2');
    expect((await t.request('PUT', `${t.F}/text`, { path: md.path, text: '# R3', mtime: md.mtime - 5000 })).status).toBe(409);
    expect((await t.request('PUT', `${t.F}/text`, { path: md.path, text: 'x'.repeat(1024 * 1024 + 1), mtime: ok.json.mtime })).status).toBe(413);
  });

  it('raw with artefact=1: scripts without network only for an HTML page under sessions/, inside a frame', async () => {
    const t = await setup();
    mkdirSync(join(t.ws, 'sessions', 's1'), { recursive: true });
    for (const f of ['sessions/s1/page.html', 'sessions/s1/page.HTM', 'sessions/s1/notes.txt', 'inbox/page.html']) writeFileSync(join(t.ws, f), '<p>x</p>');
    const csp = async (q: string, dest = 'iframe') => (await t.rawRequest('GET', `${t.F}/raw?${q}`, { headers: { 'Sec-Fetch-Dest': dest } })).headers.get('content-security-policy');
    for (const p of ['sessions/s1/page.html', 'sessions/s1/page.HTM', './sessions//s1/page.html']) {
      const v = await csp(`path=${t.q(p)}&artefact=1`);
      expect(v, p).toContain('sandbox allow-scripts;');
      expect(v, p).toContain("default-src 'none'");
      expect(v, p).not.toContain('allow-same-origin');
    }
    expect(await csp(`path=${t.q('sessions/s1/page.html')}`)).toBe(FILE_CSP);
    expect(await csp(`path=${t.q('sessions/s1/page.html')}&artefact=1&download=1`)).toBe(FILE_CSP);
    expect(await csp(`path=${t.q('sessions/s1/notes.txt')}&artefact=1`)).toBe(FILE_CSP);
    expect(await csp(`path=${t.q('inbox/page.html')}&artefact=1`)).toBe(FILE_CSP);
    // opened as a page (tab, link) rather than in a frame of the app: no scripts
    expect(await csp(`path=${t.q('sessions/s1/page.html')}&artefact=1`, 'document')).toBe(FILE_CSP);
    expect((await t.rawRequest('GET', `${t.F}/raw?path=${t.q('sessions/s1/page.html')}&artefact=1`)).headers.get('content-security-policy')).toBe(FILE_CSP);
    expect((await t.rawRequest('GET', `${t.F}/raw?path=${t.q('sessions/../inbox/page.html')}&artefact=1`)).status).toBe(400);
  });

  it('raw: sandbox, framing by Intendia only, type from the extension, download', async () => {
    const t = await setup();
    const res = await t.rawRequest('GET', `${t.F}/raw?path=files/doc.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBe('8');
    expect(res.headers.get('content-disposition')).toMatch(/^inline/);
    const dl = await t.rawRequest('GET', `${t.F}/raw?path=${t.q('files/Rapport été.md')}&download=1`);
    expect(dl.headers.get('content-disposition')).toContain("attachment; filename=\"Rapport _t_.md\"; filename*=UTF-8''Rapport%20%C3%A9t%C3%A9.md");
    expect(await dl.text()).toBe('# R');
    expect((await t.rawRequest('GET', `${t.F}/raw?path=files/sub`)).status).toBe(400);
    expect((await t.rawRequest('GET', '/x/workspaces')).headers.get('x-frame-options')).toBe('DENY');
  });

  it('Hermes unreachable: the Files routes answer 502', async () => {
    const breaks: Record<string, { status: number }> = {};
    const t = await setup({ breaks });
    breaks['dash GET /api/files'] = { status: 503 };
    const res = await t.request('GET', `${t.F}/tree`);
    expect(res.status).toBe(502);
    expect(res.json.error).toBe('Hermes a répondu HTTP 503');
  });
});

describe('two instances', () => {
  it('a workspace of the second instance only writes into that Hermes', async () => {
    const t = await testApp({ extra: [{ id: 'fake2', label: 'Bureau', ownFake: true }] });
    expect((await t.request('POST', '/x/workspaces', { slug: 'bureau', name: 'Bureau', instanceId: 'fake2' })).status).toBe(201);
    const root2 = t.fakes.fake2!.files.root;
    expect(existsSync(join(root2, 'bureau', 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(t.root, 'bureau'))).toBe(false);
    expect((await t.rawRequest('PUT', '/x/workspaces/bureau/files/upload?dir=inbox&name=n.txt', { body: 'n' })).status).toBe(201);
    expect(readFileSync(join(root2, 'bureau', 'inbox', 'n.txt'), 'utf8')).toBe('n');
    expect(existsSync(join(t.root, 'bureau'))).toBe(false);
  });
});
