import { Hono } from 'hono';
import type { DiffWhich, GitService } from '../git/service.js';
import { ValidationError } from '../workspaces/service.js';
import { slugOf } from './files.js';

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
    if (!WHICH.has(which)) throw new ValidationError('which invalide');
    const text = await git.diff(slugOf(c), repo(c), c.req.query('file') ?? '', which);
    return c.body(text, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  });
  r.get(`${base}/branches`, async (c) => c.json(await git.branches(slugOf(c), repo(c))));
  return r;
}
