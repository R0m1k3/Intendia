import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AgentService } from '../agents/service.js';
import { ValidationError } from '../workspaces/service.js';
import { PROFILE_RE } from './params.js';

const CreateBody = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(1000).optional(),
  cloneFrom: z.string().regex(PROFILE_RE).optional(),
});
const DescriptionBody = z.object({ description: z.string().max(1000) });

function nameOf(c: Context): string {
  const name = c.req.param('name') ?? '';
  if (!PROFILE_RE.test(name)) throw new ValidationError('nom d’agent invalide');
  return name;
}

export function agentRoutes(agents: AgentService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  r.get('/i/:inst/agents', async (c) => c.json({ agents: await agents.list(inst(c)) }));
  r.post('/i/:inst/agents', async (c) => c.json(await agents.create(inst(c), CreateBody.parse(await c.req.json())), 201));
  // names only, for the selectors; registered before /:name/... (a profile may be called "profiles")
  r.get('/i/:inst/agents/profiles', async (c) => c.json({ profiles: await agents.profiles(inst(c)) }));
  r.get('/i/:inst/agents/:name/detail', async (c) => c.json({ agent: await agents.get(inst(c), nameOf(c)) }));
  r.put('/i/:inst/agents/:name/description', async (c) => {
    const body = DescriptionBody.parse(await c.req.json());
    return c.json(await agents.setDescription(inst(c), nameOf(c), body.description));
  });
  return r;
}
