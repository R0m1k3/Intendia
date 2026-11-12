import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { MemoryService } from '../memory/service.js';
import { profileOf } from './skills.js';

const ID = z.string().max(80);
const PutBody = z.object({ id: ID, content: z.string().max(20_000) });

/** Built-in memory and learning graph of a profile (`?profile=`, default `default`). */
export function memoryRoutes(memory: MemoryService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  r.get('/i/:inst/memory', async (c) => c.json(await memory.overview(inst(c), profileOf(c))));
  r.get('/i/:inst/memory/entry', async (c) => c.json(await memory.entry(inst(c), profileOf(c), ID.parse(c.req.query('id') ?? ''))));
  r.put('/i/:inst/memory/entry', async (c) => {
    const body = PutBody.parse(await c.req.json());
    return c.json(await memory.update(inst(c), profileOf(c), body.id, body.content));
  });
  r.delete('/i/:inst/memory/entry', async (c) => c.json(await memory.remove(inst(c), profileOf(c), ID.parse(c.req.query('id') ?? ''))));
  return r;
}
