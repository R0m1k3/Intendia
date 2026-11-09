import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const BoardSchema = z.looseObject({
  columns: z.array(z.looseObject({ name: z.string(), tasks: z.array(z.looseObject({ id: z.union([z.string(), z.number()]) })) })),
  latest_event_id: z.number().optional(),
});
export const BoardListSchema = z.looseObject({
  boards: z.array(z.looseObject({ slug: z.string(), name: z.string().optional() })),
  current: z.string().optional(),
});

const K = '/api/plugins/kanban';

export const kanbanModule: ModuleDef = {
  id: 'kanban',
  label: 'Kanban',
  dashboardPage: '/kanban',
  ops: {
    board: { kind: 'read', required: true, probe: true, schema: BoardSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/board` }] },
    boards: { kind: 'read', probe: true, schema: BoardListSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/boards` }] },
    task: { kind: 'read', probe: false, routes: [{ via: 'dash', method: 'GET', path: `${K}/tasks/{task_id}` }] },
    createTask: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks` }] },
    updateTask: { kind: 'write', routes: [{ via: 'dash', method: 'PATCH', path: `${K}/tasks/{task_id}` }] },
    bulk: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks/bulk` }] },
    comment: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks/{task_id}/comments` }] },
    link: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/links` }] },
    dispatch: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/dispatch` }] },
    orchestration: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: `${K}/orchestration` }] },
  },
};
