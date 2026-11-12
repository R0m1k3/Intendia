import { Hono, type Context } from 'hono';
import type { MonitorService } from '../monitor/service.js';
import { ValidationError } from '../workspaces/service.js';
import { profileOf } from './skills.js';

function int(c: Context, name: string, fallback: number): number {
  const v = c.req.query(name);
  if (v === undefined || v === '') return fallback;
  if (!/^\d{1,4}$/.test(v)) throw new ValidationError(`${name} invalide`);
  return Number(v);
}

export function monitorRoutes(monitor: MonitorService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  r.get('/i/:inst/monitor/usage', async (c) => c.json(await monitor.usage(inst(c), profileOf(c), int(c, 'days', 30))));
  r.get('/i/:inst/monitor/logs', async (c) => c.json(await monitor.logs(inst(c), profileOf(c), {
    file: c.req.query('file') ?? 'agent',
    lines: int(c, 'lines', 100),
    level: c.req.query('level') || undefined,
    component: c.req.query('component') || undefined,
    search: c.req.query('search') || undefined,
  })));
  r.get('/i/:inst/monitor/system', async (c) => c.json(await monitor.systemStats(inst(c))));
  return r;
}
