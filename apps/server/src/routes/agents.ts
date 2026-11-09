import { Hono } from 'hono';
import type { AgentService } from '../agents/service.js';

export function agentRoutes(agents: AgentService): Hono {
  const r = new Hono();
  r.get('/i/:inst/agents/profiles', async (c) => c.json({ profiles: await agents.profiles(c.req.param('inst')) }));
  return r;
}
