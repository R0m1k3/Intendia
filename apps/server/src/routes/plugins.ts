import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { PluginService } from '../plugins/service.js';

const InstallBody = z.object({ name: z.string().max(100) });

/** Agent plugins of an instance (no profile: Hermes installs them once for every agent). */
export function pluginRoutes(plugins: PluginService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  const name = (c: Context) => c.req.param('name') ?? '';
  r.get('/i/:inst/plugins', async (c) => c.json(await plugins.list(inst(c))));
  r.get('/i/:inst/plugins/catalog', async (c) => c.json(await plugins.catalog(inst(c))));
  r.post('/i/:inst/plugins/install', async (c) => c.json(await plugins.install(inst(c), InstallBody.parse(await c.req.json()).name), 202));
  r.get('/i/:inst/plugins/jobs', (c) => c.json(plugins.current(inst(c))));
  r.get('/i/:inst/plugins/jobs/:job', (c) => c.json(plugins.job(inst(c), c.req.param('job'))));
  r.post('/i/:inst/plugins/:name/enable', async (c) => c.json(await plugins.setEnabled(inst(c), name(c), true)));
  r.post('/i/:inst/plugins/:name/disable', async (c) => c.json(await plugins.setEnabled(inst(c), name(c), false)));
  r.delete('/i/:inst/plugins/:name', async (c) => c.json(await plugins.remove(inst(c), name(c))));
  return r;
}
