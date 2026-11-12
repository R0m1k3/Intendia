import { Hono } from 'hono';
import { z } from 'zod';
import { PROMPT_KINDS, type PromptService } from '../prompts/service.js';

const Kind = z.enum(PROMPT_KINDS);
const Create = z.object({ kind: Kind.default('prompt'), title: z.string().max(1000), body: z.string().max(100_000) });
const Patch = z.object({ title: z.string().max(1000).optional(), body: z.string().max(100_000).optional() });

/** /x/prompts* (authenticated by the caller). */
export function promptRoutes(prompts: PromptService): Hono {
  const r = new Hono();
  r.get('/prompts', (c) => {
    const kind = c.req.query('kind');
    return c.json({ prompts: prompts.list(kind ? Kind.parse(kind) : undefined) });
  });
  r.post('/prompts', async (c) => c.json({ prompt: prompts.create(Create.parse(await c.req.json())) }, 201));
  r.patch('/prompts/:id', async (c) => c.json({ prompt: prompts.update(c.req.param('id'), Patch.parse(await c.req.json())) }));
  r.delete('/prompts/:id', (c) => {
    prompts.remove(c.req.param('id'));
    return c.json({ ok: true });
  });
  return r;
}
