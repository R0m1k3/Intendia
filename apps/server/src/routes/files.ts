import { Hono } from 'hono';
import { z } from 'zod';
import type { FileService } from '../files/service.js';
import { EXISTS_MAX } from '../files/service.js';
import { sendFile } from '../files/send.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { ValidationError } from '../workspaces/service.js';

const Move = z.object({ from: z.string(), to: z.string() });
const Text = z.object({ path: z.string(), text: z.string(), mtime: z.number() });
const Exists = z.object({ paths: z.array(z.string().max(1024)).max(EXISTS_MAX) });
const Share = z.object({ path: z.string() });

function slugOf(c: { req: { param: (k: string) => string } }): string {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) throw new ValidationError('workspace invalide');
  return slug;
}

/** Workspace files, under /x/workspaces/:slug/files (authenticated by the caller). */
export function fileRoutes(files: FileService): Hono {
  const r = new Hono();
  const base = '/workspaces/:slug/files';

  r.get(`${base}/tree`, (c) => c.json(files.list(slugOf(c), c.req.query('path') ?? '')));

  r.get(`${base}/search`, (c) => c.json(files.search(slugOf(c), (c.req.query('q') ?? '').slice(0, 200))));

  r.get(`${base}/raw`, (c) => {
    const { abs, name } = files.resolveForRead(slugOf(c), c.req.query('path') ?? '');
    return sendFile(c, abs, name, { download: c.req.query('download') === '1' });
  });

  r.put(`${base}/upload`, async (c) => {
    const res = await files.upload(slugOf(c), c.req.query('dir') ?? 'inbox', c.req.query('name') ?? '', c.req.raw.body);
    return c.json(res, 201);
  });

  r.patch(`${base}/move`, async (c) => {
    const { from, to } = Move.parse(await c.req.json());
    return c.json(files.move(slugOf(c), from, to));
  });

  r.delete(base, (c) => {
    files.remove(slugOf(c), c.req.query('path') ?? '');
    return c.json({ ok: true });
  });

  r.put(`${base}/text`, async (c) => {
    const { path, text, mtime } = Text.parse(await c.req.json());
    return c.json(files.writeText(slugOf(c), path, text, mtime));
  });

  r.post(`${base}/exists`, async (c) => {
    const { paths } = Exists.parse(await c.req.json());
    return c.json({ results: files.exists(slugOf(c), paths) });
  });

  r.post(`${base}/share`, async (c) => {
    const { path } = Share.parse(await c.req.json());
    return c.json(files.share(slugOf(c), path), 201);
  });

  return r;
}
