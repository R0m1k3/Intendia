import { Hono } from 'hono';
import type { ActivityService } from '../agents/activity.js';

export function activityRoutes(activity: ActivityService): Hono {
  const r = new Hono();
  r.get('/i/:inst/activity', async (c) => c.json(await activity.list(c.req.param('inst'))));
  // every instance: the notifications of Intendia answer them without switching instance
  r.get('/approvals', async (c) => c.json(await activity.approvals()));
  return r;
}
