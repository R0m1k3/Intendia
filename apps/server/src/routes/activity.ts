import { Hono } from 'hono';
import type { ActivityService } from '../agents/activity.js';

export function activityRoutes(activity: ActivityService): Hono {
  const r = new Hono();
  r.get('/activity', async (c) => c.json(await activity.list()));
  return r;
}
