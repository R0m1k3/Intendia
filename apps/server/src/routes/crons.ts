import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { CronService } from '../crons/service.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { PROFILE_RE } from './params.js';
import { ValidationError } from '../workspaces/service.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const Fields = {
  name: z.string().trim().min(1).max(120),
  prompt: z.string().min(1).max(20_000),
  deliver: z.string().trim().min(1).max(200),
  skills: z.array(z.string().regex(/^[A-Za-z0-9_.:/-]{1,80}$/)).max(30).default([]),
  model: z.string().trim().min(1).max(200).nullable().default(null),
  workspace: z.string().regex(SLUG_RE).nullable().default(null),
};
const CreateBody = z.object({ ...Fields, schedule: z.string().trim().min(1).max(200), paused: z.boolean().default(false) });
const UpdateBody = z.object({ ...Fields, schedule: z.string().trim().min(1).max(200).optional() });

function ids(c: Context): { inst: string; id: string; profile: string } {
  const id = c.req.param('id') ?? '';
  const profile = c.req.query('profile') ?? '';
  if (!ID_RE.test(id)) throw new ValidationError('identifiant de cron invalide');
  if (!PROFILE_RE.test(profile)) throw new ValidationError('profil invalide ou absent');
  return { inst: c.req.param('inst') ?? '', id, profile };
}

export function cronRoutes(crons: CronService): Hono {
  const r = new Hono();

  r.get('/crons/overview', async (c) => c.json(await crons.overview()));

  r.get('/i/:inst/crons', async (c) => c.json({ crons: await crons.list(c.req.param('inst')) }));
  r.post('/i/:inst/crons', async (c) => {
    const body = CreateBody.parse(await c.req.json());
    return c.json({ cron: await crons.create(c.req.param('inst'), body) }, 201);
  });
  // before /:id, which would match "targets"
  r.get('/i/:inst/crons/targets', async (c) => c.json({ targets: await crons.targets(c.req.param('inst')) }));

  r.get('/i/:inst/crons/:id', async (c) => {
    const { inst, id, profile } = ids(c);
    return c.json({ cron: await crons.get(inst, id, profile) });
  });
  r.put('/i/:inst/crons/:id', async (c) => {
    const { inst, id, profile } = ids(c);
    const body = UpdateBody.parse(await c.req.json());
    return c.json({ cron: await crons.update(inst, id, profile, body) });
  });
  r.delete('/i/:inst/crons/:id', async (c) => {
    const { inst, id, profile } = ids(c);
    await crons.remove(inst, id, profile);
    return c.body(null, 204);
  });
  for (const op of ['pause', 'resume', 'trigger'] as const) {
    r.post(`/i/:inst/crons/:id/${op}`, async (c) => {
      const { inst, id, profile } = ids(c);
      return c.json({ cron: await crons[op](inst, id, profile) });
    });
  }
  r.post('/i/:inst/crons/:id/cancel', async (c) => {
    const { inst, id, profile } = ids(c);
    return c.json(await crons.cancel(inst, id, profile));
  });
  r.get('/i/:inst/crons/:id/runs', async (c) => {
    const { inst, id, profile } = ids(c);
    return c.json({ runs: await crons.runs(inst, id, profile) });
  });
  return r;
}
