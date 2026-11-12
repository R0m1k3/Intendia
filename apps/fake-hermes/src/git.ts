/**
 * Git routes of the dashboard (`/api/fs/git-root`, `/api/git/*`), like Hermes 0.23 (`hermes_cli/web_git.py`):
 * the real `git` runs in the folder given as `path`, **without any confinement to the files root** (Hermes does not
 * confine them either: the tests prove that Intendia does). Only the diff routes refuse credential files, with 403.
 * Unlike the rest of the fake, nothing is replayed: a real repository is the only way to test staging and commits.
 */
import { execFile } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const TIMEOUT_MS = 30_000;

export interface GitFakeOptions {
  /** `review/revert` answers ok without doing anything (Hermes ignores git's errors there). */
  revertNoop?: boolean;
}

interface Run { code: number; out: string; err: string }

class HttpFail extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SENSITIVE = /(^|\/)(\.env(\..*)?|\.envrc|auth\.json|auth\.lock|credentials|config\.yaml|\.git-credentials|\.anthropic_oauth\.json|google_token\.json|google_oauth(_pending)?\.json|webhook_subscriptions\.json|bws_cache(\.enc)?\.json|op_cache\.json|photon-sidecar\.json)$|(^|\/)(mcp-tokens|pairing)(\/|$)/i;

function git(cwd: string, args: string[]): Promise<Run> {
  return new Promise((done) => {
    execFile('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      done({ code, out: String(stdout), err: String(stderr) });
    });
  });
}

async function ok(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new HttpFail(400, (r.err || r.out).trim() || 'git invocation failed');
  return r.out;
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

interface Entry { tag: string; xy: string; path: string }

function entries(raw: string): { entries: Entry[]; branch: string | null; detached: boolean; ahead: number; behind: number } {
  const recs = raw.split('\0');
  const out: Entry[] = [];
  let branch: string | null = null;
  let detached = false;
  let ahead = 0;
  let behind = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i]!;
    if (!rec) continue;
    if (rec.startsWith('# branch.head ')) {
      const head = rec.slice('# branch.head '.length);
      detached = head === '(detached)';
      branch = detached ? null : head;
    } else if (rec.startsWith('# branch.ab ')) {
      for (const tok of rec.split(' ').slice(2)) {
        if (tok.startsWith('+')) ahead = Number(tok.slice(1));
        else if (tok.startsWith('-')) behind = Number(tok.slice(1));
      }
    } else if (rec.startsWith('#')) {
      continue;
    } else if (rec.startsWith('? ')) {
      out.push({ tag: '?', xy: '??', path: rec.slice(2) });
    } else if (rec.startsWith('1 ')) {
      const parts = rec.split(' ');
      out.push({ tag: '1', xy: parts[1]!, path: parts.slice(8).join(' ') });
    } else if (rec.startsWith('2 ')) {
      const parts = rec.split(' ');
      out.push({ tag: '2', xy: parts[1]!, path: parts.slice(9).join(' ') });
      i++; // origin path
    } else if (rec.startsWith('u ')) {
      const parts = rec.split(' ');
      out.push({ tag: 'u', xy: parts[1]!, path: parts.slice(10).join(' ') });
    }
  }
  return { entries: out, branch, detached, ahead, behind };
}

const stagedOf = (e: Entry) => (e.tag === '1' || e.tag === '2') && !['.', '?'].includes(e.xy[0]!);
const letterOf = (e: Entry) => {
  if (e.tag === '?' || e.tag === 'u') return e.tag.toUpperCase();
  const code = e.xy[0] !== '.' ? e.xy[0]! : e.xy[1] ?? '.';
  return (code !== '.' ? code : 'M').toUpperCase();
};

async function numstat(cwd: string, args: string[]): Promise<Map<string, [number, number]>> {
  const r = await git(cwd, ['diff', '--numstat', '--no-renames', ...args]);
  const m = new Map<string, [number, number]>();
  for (const line of r.out.split('\n')) {
    const [a, d, ...p] = line.split('\t');
    if (p.length) m.set(p.join('\t'), [Number(a) || 0, Number(d) || 0]);
  }
  return m;
}

export class GitStore {
  /** Every git call received, for the tests (`/_fake/git/calls` too). */
  readonly calls: { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null }[] = [];

  constructor(private readonly opts: GitFakeOptions = {}) {}

  private async status(cwd: string) {
    const r = await git(cwd, ['status', '--porcelain=v2', '--branch', '-z']);
    if (r.code !== 0) return null;
    return entries(r.out);
  }

  private async allAdd(cwd: string, file: string): Promise<string> {
    if (!existsSync(join(cwd, file)) || isDir(join(cwd, file))) return '';
    return (await git(cwd, ['diff', '--no-index', '--', '/dev/null', file])).out;
  }

  async handle(method: string, path: string, req: Request, query: Record<string, string>): Promise<Response | null> {
    if (path !== '/api/fs/git-root' && !path.startsWith('/api/git/')) return null;
    const body = method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : null;
    this.calls.push({ method, path, query, body });
    try {
      const raw = String((body ? body.path : query.path) ?? '');
      if (!raw || raw.includes('\0')) throw new HttpFail(400, 'path required');
      const target = real(raw);
      if (method === 'GET' && path === '/api/fs/git-root') {
        let dir = isDir(target) ? target : dirname(target);
        for (let i = 0; i < 50; i++) {
          if (existsSync(join(dir, '.git'))) return json(200, { root: dir });
          const up = dirname(dir);
          if (up === dir) break;
          dir = up;
        }
        return json(200, { root: null });
      }
      const cwd = target;
      const file = String((body ? body.file : query.file) ?? '');
      if (method === 'GET') {
        if (!isDir(cwd)) return json(200, path === '/api/git/status' ? null : { files: [], diff: '' });
        switch (path) {
          case '/api/git/status': {
            const st = await this.status(cwd);
            if (!st) return json(200, null);
            const files = st.entries.map((e) => ({
              path: e.path, staged: stagedOf(e), unstaged: e.tag === '?' || ((e.tag === '1' || e.tag === '2') && !['.', '?'].includes(e.xy[1]!)),
              untracked: e.tag === '?', conflicted: e.tag === 'u',
            }));
            const sum = (k: 'staged' | 'unstaged' | 'untracked' | 'conflicted') => files.filter((f) => f[k]).length;
            return json(200, {
              branch: st.branch, defaultBranch: null, detached: st.detached, ahead: st.ahead, behind: st.behind,
              staged: sum('staged'), unstaged: sum('unstaged'), untracked: sum('untracked'), conflicted: sum('conflicted'),
              changed: files.length, added: 0, removed: 0, files: files.slice(0, 200),
            });
          }
          case '/api/git/review/list': {
            const st = await this.status(cwd);
            if (!st) return json(200, { files: [], base: null });
            const [staged, unstaged] = await Promise.all([numstat(cwd, ['--cached']), numstat(cwd, [])]);
            const files = st.entries.map((e) => {
              const [sa, sr] = staged.get(e.path) ?? [0, 0];
              const [ua, ur] = unstaged.get(e.path) ?? [0, 0];
              return { path: e.path, added: sa + ua, removed: sr + ur, status: letterOf(e), staged: stagedOf(e) };
            }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
            return json(200, { files, base: null });
          }
          case '/api/git/review/diff':
          case '/api/git/file-diff': {
            if (!file) throw new HttpFail(422, 'file required');
            if (SENSITIVE.test(file)) return json(403, { detail: 'Path is outside the managed read boundary' });
            const literal = `:(literal)${file}`;
            if (path === '/api/git/file-diff') {
              const head = (await git(cwd, ['diff', 'HEAD', '--no-renames', '--', literal])).out;
              if (head.trim()) return json(200, { diff: head });
              const s = (await git(cwd, ['status', '--porcelain', '--', literal])).out;
              return json(200, { diff: s.startsWith('??') ? await this.allAdd(cwd, file) : '' });
            }
            if (query.staged === 'true') return json(200, { diff: (await git(cwd, ['diff', '--cached', '--no-renames', '--', literal])).out });
            const work = (await git(cwd, ['diff', '--no-renames', '--', literal])).out;
            return json(200, { diff: work.trim() ? work : await this.allAdd(cwd, file) });
          }
          case '/api/git/branches': {
            const out = await ok(cwd, ['for-each-ref', '--format=%(refname:short)%00%(HEAD)', 'refs/heads']);
            const branches = out.split('\n').filter(Boolean).map((l) => {
              const [name, head] = l.split('\0');
              return { name: name!, checkedOut: head === '*', isDefault: false, isRemote: false, worktreePath: null };
            });
            return json(200, { branches });
          }
          case '/api/git/review/commit-context': {
            const hasStaged = (await git(cwd, ['diff', '--cached', '--quiet'])).code !== 0;
            const diff = (await git(cwd, ['diff', ...(hasStaged ? ['--cached'] : ['HEAD'])])).out.slice(0, 120_000);
            const recent = (await git(cwd, ['log', '-10', '--format=%s'])).out.trim();
            return json(200, { diff, recent });
          }
          default:
            return json(404, { detail: 'Not Found' });
        }
      }
      if (method === 'POST') {
        switch (path) {
          case '/api/git/review/stage':
            await ok(cwd, file ? ['add', '--', file] : ['add', '-A']);
            return json(200, { ok: true });
          case '/api/git/review/unstage':
            await ok(cwd, ['reset', '-q', 'HEAD', ...(file ? ['--', file] : [])]);
            return json(200, { ok: true });
          case '/api/git/review/revert':
            if (!this.opts.revertNoop) {
              await git(cwd, ['checkout', 'HEAD', '--', file || '.']);
              await git(cwd, ['clean', '-fd', '--', file || '.']);
            }
            return json(200, { ok: true });
          case '/api/git/review/commit': {
            const message = String(body?.message ?? '').trim();
            if (!message) throw new HttpFail(400, 'Commit message required');
            if ((await git(cwd, ['diff', '--cached', '--quiet'])).code === 0) await ok(cwd, ['add', '-A']);
            await ok(cwd, ['commit', '-q', '-m', message]);
            if (body?.push) await this.push(cwd);
            return json(200, { ok: true });
          }
          case '/api/git/review/push':
            await this.push(cwd);
            return json(200, { ok: true });
          case '/api/git/branch/switch': {
            const branch = String(body?.branch ?? '').trim();
            if (!branch) throw new HttpFail(400, 'branch required');
            await ok(cwd, ['switch', branch]);
            return json(200, { branch });
          }
          default:
            return json(404, { detail: 'Not Found' });
        }
      }
      return json(405, { detail: 'Method Not Allowed' });
    } catch (err) {
      if (err instanceof HttpFail) return json(err.status, { detail: err.message });
      return json(500, { detail: (err as Error).message });
    }
  }

  private async push(cwd: string): Promise<void> {
    const branch = (await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])).out.trim();
    if (!branch) return;
    const upstream = (await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).code === 0;
    await ok(cwd, upstream ? ['push', '-q'] : ['push', '-q', '-u', 'origin', branch]);
  }
}
