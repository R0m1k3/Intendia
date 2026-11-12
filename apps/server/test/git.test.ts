import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile } from '../src/git/service.js';
import { hiddenByHermes } from '../src/files/paths.js';
import { tempDir, testApp } from './helpers.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'init.defaultBranch=main', ...args], {
  cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'pipe',
}).toString();

/** A repository with one commit, in `dir`. */
function repo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'un\n');
  writeFileSync(join(dir, 'b.txt'), 'deux\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

async function setup(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  const ws = join(t.root, 'dev');
  const G = '/x/workspaces/dev/git';
  const q = encodeURIComponent;
  const gitCalls = () => t.fake.git.calls.filter((c) => c.path.startsWith('/api/git/')).length;
  return { ...t, ws, G, q, gitCalls };
}

describe('checkFile', () => {
  it('keeps a plain path and a folder line, refuses pathspec magic and traversal', () => {
    expect(checkFile('src/a.ts')).toEqual({ path: 'src/a.ts', dir: false });
    expect(checkFile('neuf/')).toEqual({ path: 'neuf/', dir: true });
    for (const bad of ['*', ':x', 'a/[b]', 'a?', '../x', '/etc/passwd', '']) expect(() => checkFile(bad), bad).toThrow();
  });

  it('credential files of Hermes are sensitive', () => {
    for (const p of ['a/photon-sidecar.json', '.env', 'x/.env.local', 'google_token.json', 'mcp-tokens/s.json']) expect(hiddenByHermes(p), p).toBe(true);
    expect(hiddenByHermes('src/env.ts')).toBe(false);
  });
});

describe('locate', () => {
  it('a repository at the workspace root or in a sub-folder; none elsewhere', async () => {
    const t = await setup();
    repo(join(t.ws, 'projet'));
    mkdirSync(join(t.ws, 'projet', 'src', 'deep'), { recursive: true });
    expect((await t.request('GET', `${t.G}/locate?path=projet/src/deep`)).json).toEqual({ repo: 'projet', outside: false });
    expect((await t.request('GET', `${t.G}/locate?path=`)).json).toEqual({ repo: null, outside: false });
    repo(t.ws);
    expect((await t.request('GET', `${t.G}/locate?path=`)).json).toEqual({ repo: '', outside: false });
  });

  it('a repository starting above the workspace is outside, and refused', async () => {
    const t = await setup();
    repo(t.root);
    mkdirSync(join(t.ws, 'files'), { recursive: true });
    expect((await t.request('GET', `${t.G}/locate?path=files`)).json).toEqual({ repo: null, outside: true });
    const res = await t.request('GET', `${t.G}?repo=`);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('outside');
  });
});

describe('open: only the root of a repository inside the workspace', () => {
  it('a sub-folder of a repository, a link to a repository outside, a .git file: 403; ".." 400', async () => {
    const t = await setup();
    repo(join(t.ws, 'projet'));
    mkdirSync(join(t.ws, 'projet', 'src'));
    expect((await t.request('GET', `${t.G}?repo=projet/src`)).status).toBe(403);
    const outside = repo(join(tempDir(), 'ailleurs'));
    symlinkSync(outside, join(t.ws, 'lien'));
    expect((await t.request('GET', `${t.G}?repo=lien`)).status).toBe(403);
    mkdirSync(join(t.ws, 'wt'));
    writeFileSync(join(t.ws, 'wt', '.git'), `gitdir: ${join(outside, '.git')}\n`);
    const wt = await t.request('GET', `${t.G}?repo=wt`);
    expect(wt.status).toBe(403);
    expect(wt.json.error).toContain('.git est un lien ou un fichier');
    expect((await t.request('GET', `${t.G}?repo=../x`)).status).toBe(400);
    // never a git command outside: only git-root was asked about the refused folders
    expect(t.gitCalls()).toBe(0);
  });
});

describe('status', () => {
  it('staged, staged + modified, modified, untracked file and folder, sensitive', async () => {
    const t = await setup();
    const r = repo(join(t.ws, 'projet'));
    writeFileSync(join(r, 'a.txt'), 'un\nmodifié\n');
    git(r, 'add', 'a.txt');
    writeFileSync(join(r, 'a.txt'), 'un\nmodifié\nencore\n');
    writeFileSync(join(r, 'b.txt'), 'deux bis\n');
    writeFileSync(join(r, 'c.txt'), 'nouveau\n');
    writeFileSync(join(r, '.env'), 'SECRET=1\n');
    mkdirSync(join(r, 'neuf'));
    writeFileSync(join(r, 'neuf', 'x.txt'), 'x\n');
    const res = await t.request('GET', `${t.G}?repo=projet`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ repo: 'projet', branch: 'main', detached: false, truncated: false });
    const by = Object.fromEntries(res.json.files.map((f: any) => [f.path, f]));
    expect(by['a.txt']).toMatchObject({ status: 'M', staged: true, unstaged: true, dir: false, sensitive: false });
    expect(by['b.txt']).toMatchObject({ status: 'M', staged: false, unstaged: true });
    expect(by['c.txt']).toMatchObject({ status: '?', staged: false, unstaged: true });
    expect(by['neuf/']).toMatchObject({ status: '?', dir: true });
    expect(by['.env']).toMatchObject({ sensitive: true });
    expect(res.json.counts).toMatchObject({ staged: 1, untracked: 3 });
  });

  it('a conflict is flagged', async () => {
    const t = await setup();
    const r = repo(join(t.ws, 'projet'));
    git(r, 'switch', '-q', '-c', 'autre');
    writeFileSync(join(r, 'a.txt'), 'autre\n');
    git(r, 'commit', '-q', '-am', 'autre');
    git(r, 'switch', '-q', 'main');
    writeFileSync(join(r, 'a.txt'), 'principal\n');
    git(r, 'commit', '-q', '-am', 'principal');
    try { git(r, 'merge', 'autre'); } catch { /* conflict expected */ }
    const res = await t.request('GET', `${t.G}?repo=projet`);
    expect(res.json.files.find((f: any) => f.path === 'a.txt')).toMatchObject({ conflicted: true, status: 'U' });
  });

  it('more than 1 000 changes: 1 000 sent, truncated', async () => {
    const t = await setup();
    const r = repo(join(t.ws, 'projet'));
    for (let i = 0; i < 1005; i++) writeFileSync(join(r, `f${String(i).padStart(4, '0')}.txt`), 'x');
    const res = await t.request('GET', `${t.G}?repo=projet`);
    expect(res.json.files).toHaveLength(1000);
    expect(res.json.truncated).toBe(true);
  }, 30_000);

  it('git hidden by the instance: module unavailable, 409', async () => {
    const t = await setup({ hide: { openapi: ['GET /api/git/status'] } });
    repo(join(t.ws, 'projet'));
    const res = await t.request('GET', `${t.G}?repo=projet`);
    expect(res.status).toBe(409);
    expect(res.json.module).toBe('git');
    const report = t.compat.get('fake');
    expect(report?.modules.find((m) => m.id === 'git')?.state).toBe('unavailable');
  });
});

describe('repository at the workspace root', () => {
  it('status, diff and a credential file flagged, with paths relative to the root', async () => {
    const t = await setup();
    repo(t.ws);
    writeFileSync(join(t.ws, 'a.txt'), 'changé\n');
    writeFileSync(join(t.ws, '.env'), 'S=1\n');
    writeFileSync(join(t.ws, 'nom\\bizarre.txt'), 'x\n');
    const res = await t.request('GET', `${t.G}?repo=`);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.json.files.map((f: any) => [f.path, f]));
    expect(by['a.txt']).toMatchObject({ sensitive: false, unstaged: true });
    expect(by['.env']).toMatchObject({ sensitive: true });
    expect(Object.keys(by)).toContain('nom\\bizarre.txt');
    const d = await t.raw('GET', `${t.G}/diff?repo=&file=a.txt&which=unstaged`);
    expect(await d.text()).toContain('+changé');
    expect((await t.request('GET', `${t.G}/diff?repo=&file=.env&which=all`)).status).toBe(403);
  });
});

describe('diff', () => {
  it('staged, unstaged and all, as text', async () => {
    const t = await setup();
    const r = repo(join(t.ws, 'projet'));
    writeFileSync(join(r, 'a.txt'), 'un\nindexé\n');
    git(r, 'add', 'a.txt');
    writeFileSync(join(r, 'a.txt'), 'un\nindexé\nlibre\n');
    writeFileSync(join(r, 'c.txt'), 'nouveau\n');
    const d = async (file: string, which: string) => {
      const res = await t.raw('GET', `${t.G}/diff?repo=projet&file=${t.q(file)}&which=${which}`);
      expect(res.headers.get('content-type')).toContain('text/plain');
      return res.text();
    };
    const staged = await d('a.txt', 'staged');
    expect(staged).toContain('+indexé');
    expect(staged).not.toContain('+libre');
    expect(await d('a.txt', 'unstaged')).toContain('+libre');
    const all = await d('a.txt', 'all');
    expect(all).toContain('+indexé');
    expect(all).toContain('+libre');
    expect(await d('c.txt', 'unstaged')).toContain('+nouveau');
  });

  it('a credential file, a folder line or a pathspec: refused before Hermes', async () => {
    const t = await setup();
    const r = repo(join(t.ws, 'projet'));
    writeFileSync(join(r, '.env'), 'S=1\n');
    writeFileSync(join(r, 'google_token.json'), '{}');
    const before = t.gitCalls();
    for (const [file, status] of [['.env', 403], ['google_token.json', 403], ['neuf/', 400], ['*', 400], [':(glob)x', 400]] as const) {
      const res = await t.request('GET', `${t.G}/diff?repo=projet&file=${t.q(file)}&which=all`);
      expect(res.status, file).toBe(status);
    }
    expect(t.gitCalls()).toBe(before);
  });
});

describe('branches', () => {
  it('local branches, the current one first', async () => {
    const t = await setup();
    const r = repo(join(t.ws, 'projet'));
    git(r, 'branch', 'alpha');
    git(r, 'switch', '-q', '-c', 'zeta');
    const res = await t.request('GET', `${t.G}/branches?repo=projet`);
    expect(res.json.branches).toEqual([{ name: 'zeta', current: true }, { name: 'alpha', current: false }, { name: 'main', current: false }]);
  });
});
