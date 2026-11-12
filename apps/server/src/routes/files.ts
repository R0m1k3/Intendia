import { Hono } from 'hono';
import { z } from 'zod';
import type { InstanceFileService } from '../files/instance-files.js';
import type { FileService } from '../files/service.js';
import { EXISTS_MAX } from '../files/service.js';
import { sendFile } from '../files/send.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { ValidationError } from '../workspaces/service.js';

const Move = z.object({ from: z.string(), to: z.string() });
const Text = z.object({ path: z.string(), text: z.string(), mtime: z.number() });
const Exists = z.object({ paths: z.array(z.string().max(1024)).max(EXISTS_MAX) });
const Share = z.object({ path: z.string() });
const Extract = z.object({ path: z.string().max(1024) });

function slugOf(c: { req: { param: (k: string) => string } }): string {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) throw new ValidationError('workspace invalide');
  return slug;
}

/**
 * Workspace files, under /x/workspaces/:slug/files, and the whole file root of an instance (read only), under
 * /x/i/:inst/files (authenticated by the caller).
 */
export function fileRoutes(files: FileService, instanceFiles: InstanceFileService): Hono {
  const r = new Hono();
  const inst = (c: { req: { param: (k: string) => string | undefined } }) => c.req.param('inst') ?? '';

  r.get('/i/:inst/files/tree', async (c) => c.json(await instanceFiles.list(inst(c), c.req.query('path') ?? '')));

  r.get('/i/:inst/files/search', async (c) => c.json(await instanceFiles.search(inst(c), (c.req.query('q') ?? '').slice(0, 200))));

  r.get('/i/:inst/files/raw', async (c) => {
    const file = await instanceFiles.read(inst(c), c.req.query('path') ?? '', c.req.raw.signal);
    return sendFile(c, file, file.name, { download: c.req.query('download') === '1' });
  });

  const base = '/workspaces/:slug/files';

  r.get(`${base}/tree`, async (c) => c.json(await files.list(slugOf(c), c.req.query('path') ?? '')));

  r.get(`${base}/search`, async (c) => c.json(await files.search(slugOf(c), (c.req.query('q') ?? '').slice(0, 200))));

  r.get(`${base}/raw`, async (c) => {
    const file = await files.read(slugOf(c), c.req.query('path') ?? '', c.req.raw.signal);
    return sendFile(c, file, file.name, { download: c.req.query('download') === '1' });
  });

  r.put(`${base}/upload`, async (c) => {
    const res = await files.upload(slugOf(c), c.req.query('dir') ?? 'inbox', c.req.query('name') ?? '', c.req.raw.body, c.req.raw.signal);
    return c.json(res, 201);
  });

  // not tied to the request: the extraction goes on when the browser leaves (the folder shows up in Fichiers)
  r.post(`${base}/extract`, async (c) => {
    const { path } = Extract.parse(await c.req.json());
    return c.json(await files.extract(slugOf(c), path), 201);
  });

  r.patch(`${base}/move`, async (c) => {
    const { from, to } = Move.parse(await c.req.json());
    return c.json(await files.move(slugOf(c), from, to));
  });

  r.delete(base, async (c) => {
    await files.remove(slugOf(c), c.req.query('path') ?? '');
    return c.json({ ok: true });
  });

  r.put(`${base}/text`, async (c) => {
    const { path, text, mtime } = Text.parse(await c.req.json());
    return c.json(await files.writeText(slugOf(c), path, text, mtime));
  });

  r.post(`${base}/exists`, async (c) => {
    const { paths } = Exists.parse(await c.req.json());
    return c.json({ results: await files.exists(slugOf(c), paths) });
  });

  r.post(`${base}/share`, async (c) => {
    const { path } = Share.parse(await c.req.json());
    return c.json(await files.share(slugOf(c), path), 201);
  });

  return r;
}
