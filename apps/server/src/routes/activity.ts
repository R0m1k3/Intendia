import { Hono } from 'hono';
import type { ActivityService } from '../agents/activity.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, type WorkspaceService } from '../workspaces/service.js';

export function activityRoutes(deps: { activity: ActivityService; workspaces: WorkspaceService; store: InstanceStore }): Hono {
  const { activity, workspaces, store } = deps;
  const r = new Hono();
  r.get('/i/:inst/activity', async (c) => c.json(await activity.list(c.req.param('inst'))));
  // every instance (Centre, « Toutes les instances »)
  r.get('/activity', async (c) => c.json(await activity.listAll()));
  // runs ended in the last 24 h: one instance (`?instance=`) or all
  r.get('/activity/finished', (c) => {
    const instance = c.req.query('instance');
    if (instance !== undefined && !store.get(instance)) throw new NotFoundError(`Instance inconnue : ${instance}`);
    return c.json({ runs: workspaces.finishedRuns({ instanceId: instance }) });
  });
  // every instance: the notifications of Intendia answer them without switching instance
  r.get('/approvals', async (c) => c.json(await activity.approvals()));
  return r;
}
