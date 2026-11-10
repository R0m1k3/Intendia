import { Hono, type Context } from 'hono';
import type { KanbanService } from '../kanban/service.js';
import { ValidationError } from '../workspaces/service.js';
import { BOARD_RE, intParam } from './params.js';

/** `?board=` (required): Intendia never relies on Hermes' global "current board". */
export function boardOf(c: Context): string {
  const board = c.req.query('board') ?? '';
  if (!BOARD_RE.test(board)) throw new ValidationError('tableau invalide');
  return board;
}

export function kanbanRoutes(kanban: KanbanService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  r.get('/i/:inst/kanban/boards', async (c) => c.json({ boards: await kanban.boards(inst(c)) }));
  r.post('/i/:inst/kanban/workers/:runId/stop', async (c) =>
    c.json(await kanban.stopWorker(inst(c), boardOf(c), intParam(c.req.param('runId'), 'run'))));
  return r;
}
