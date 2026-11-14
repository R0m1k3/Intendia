import { Hono } from 'hono';
import { z } from 'zod';
import { MESSAGE_MAX, type DiffWhich, type GitService } from '../git/service.js';
import { ValidationError } from '../workspaces/service.js';
import { slugOf } from './files.js';
import { msg } from '../i18n/index.js';

const Repo = z.object({ repo: z.string().max(1024) });
const File = Repo.extend({ file: z.string().max(1024).optional() });
const Revert = Repo.extend({ file: z.string().max(1024) });
const Commit = Repo.extend({ message: z.string().max(MESSAGE_MAX + 1000), push: z.boolean().default(false) });
const Switch = Repo.extend({ branch: z.string().min(1).max(255) });
const Message = Repo.extend({ avoid: z.string().max(MESSAGE_MAX).optional() });

const WHICH = new Set<DiffWhich>(['staged', 'unstaged', 'all']);

/** Git of a workspace, under /x/workspaces/:slug/git (authenticated by the caller). */
export function gitRoutes(git: GitService): Hono {
  const r = new Hono();
  const base = '/workspaces/:slug/git';
  const repo = (c: { req: { query: (k: string) => string | undefined } }) => c.req.query('repo') ?? '';

  r.get(`${base}/locate`, async (c) => c.json(await git.locate(slugOf(c), c.req.query('path') ?? '')));
  r.get(base, async (c) => c.json(await git.status(slugOf(c), repo(c))));
  r.get(`${base}/diff`, async (c) => {
    const which = (c.req.query('which') ?? 'unstaged') as DiffWhich;
    if (!WHICH.has(which)) throw new ValidationError(msg('which invalide'));
    const text = await git.diff(slugOf(c), repo(c), c.req.query('file') ?? '', which);
    return c.body(text, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  });
  r.get(`${base}/branches`, async (c) => c.json(await git.branches(slugOf(c), repo(c))));
  r.post(`${base}/stage`, async (c) => { const b = File.parse(await c.req.json()); return c.json(await git.stage(slugOf(c), b.repo, b.file ?? null)); });
  r.post(`${base}/unstage`, async (c) => { const b = File.parse(await c.req.json()); return c.json(await git.unstage(slugOf(c), b.repo, b.file ?? null)); });
  r.post(`${base}/revert`, async (c) => { const b = Revert.parse(await c.req.json()); return c.json(await git.revert(slugOf(c), b.repo, b.file)); });
  r.post(`${base}/commit`, async (c) => { const b = Commit.parse(await c.req.json()); return c.json(await git.commit(slugOf(c), b.repo, b.message, b.push)); });
  r.post(`${base}/push`, async (c) => { const b = Repo.parse(await c.req.json()); return c.json(await git.push(slugOf(c), b.repo)); });
  r.post(`${base}/switch`, async (c) => { const b = Switch.parse(await c.req.json()); return c.json(await git.switchBranch(slugOf(c), b.repo, b.branch)); });
  r.post(`${base}/message`, async (c) => { const b = Message.parse(await c.req.json()); return c.json(await git.message(slugOf(c), b.repo, b.avoid)); });
  return r;
}
