import { z } from 'zod';
import type { ModuleDef } from '../types.js';

/** Kanban plugin of the dashboard. Shared by every profile: never sent with `?profile=`; always `?board=`. */

const id = z.union([z.string(), z.number()]);

export const TaskSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  body: z.string().nullish(),
  assignee: z.string().nullish(),
  priority: z.number().nullish(),
  workspace_kind: z.string().nullish(),
  workspace_path: z.string().nullish(),
  comment_count: z.number().optional(),
  link_counts: z.looseObject({ parents: z.number().optional(), children: z.number().optional() }).nullish(),
  progress: z.looseObject({ done: z.number(), total: z.number() }).nullish(),
  current_run_id: id.nullish(),
  last_failure_error: z.string().nullish(),
  latest_summary: z.string().nullish(),
  created_at: z.number().nullish(),
  started_at: z.number().nullish(),
  completed_at: z.number().nullish(),
});
export type HermesTask = z.infer<typeof TaskSchema>;

export const BoardSchema = z.looseObject({
  columns: z.array(z.looseObject({ name: z.string(), tasks: z.array(TaskSchema) })),
  latest_event_id: z.number().optional(),
});
export const BoardListSchema = z.looseObject({
  boards: z.array(z.looseObject({
    slug: z.string(), name: z.string().nullish(), archived: z.boolean().optional(), total: z.number().optional(),
  })),
  current: z.string().optional(),
});
export const WorkflowSchema = z.looseObject({
  columns: z.array(z.looseObject({ key: z.string(), label: z.string().optional(), drag_target: z.boolean().optional() })),
  manual: z.record(z.string(), z.array(z.string())).optional(),
});
export const AssigneesSchema = z.looseObject({
  assignees: z.array(z.looseObject({ name: z.string(), on_disk: z.boolean().optional() })),
});
/** Fields from the SQL of `list_active_workers` (plugin_api.py). */
export const WorkersSchema = z.looseObject({
  workers: z.array(z.looseObject({
    run_id: z.number(),
    task_id: z.string(),
    task_title: z.string().nullish(),
    task_status: z.string().nullish(),
    task_assignee: z.string().nullish(),
    profile: z.string().nullish(),
    started_at: z.number().nullish(),
  })),
});
export const OrchestrationSchema = z.looseObject({
  orchestrator_profile: z.string().nullish(),
  default_assignee: z.string().nullish(),
  auto_decompose: z.boolean().nullish(),
  auto_promote_children: z.boolean().nullish(),
  active_profile: z.string().nullish(),
});
export const TaskDetailSchema = z.looseObject({
  task: TaskSchema,
  comments: z.array(z.looseObject({ id: id, author: z.string().nullish(), body: z.string(), created_at: z.number().nullish() })).optional(),
  events: z.array(z.looseObject({ id: id, kind: z.string(), created_at: z.number().nullish() })).optional(),
  attachments: z.array(z.looseObject({ id: id })).optional(),
  links: z.looseObject({ parents: z.array(z.string()).optional(), children: z.array(z.string()).optional() }).optional(),
  link_tasks: z.array(z.looseObject({ id: z.string(), title: z.string().nullish(), status: z.string().nullish() })).optional(),
  runs: z.array(z.looseObject({ id: id })).optional(),
});
export const TaskLogSchema = z.looseObject({ content: z.string().nullish(), truncated: z.boolean().optional(), exists: z.boolean().optional() });

const K = '/api/plugins/kanban';

export const kanbanModule: ModuleDef = {
  id: 'kanban',
  label: 'Kanban',
  dashboardPage: '/kanban',
  ops: {
    board: { kind: 'read', required: true, probe: true, schema: BoardSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/board` }] },
    boards: { kind: 'read', probe: true, schema: BoardListSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/boards` }] },
    workflow: { kind: 'read', probe: true, schema: WorkflowSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/workflow` }] },
    assignees: { kind: 'read', probe: true, schema: AssigneesSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/assignees` }] },
    workers: { kind: 'read', probe: true, schema: WorkersSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/workers/active` }] },
    orchestration: { kind: 'read', probe: true, schema: OrchestrationSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/orchestration` }] },
    task: { kind: 'read', probe: false, schema: TaskDetailSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/tasks/{task_id}` }] },
    log: { kind: 'read', probe: false, schema: TaskLogSchema, routes: [{ via: 'dash', method: 'GET', path: `${K}/tasks/{task_id}/log` }] },
    attachment: { kind: 'read', probe: false, routes: [{ via: 'dash', method: 'GET', path: `${K}/attachments/{attachment_id}` }] },
    createBoard: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/boards` }] },
    createTask: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks` }] },
    updateTask: { kind: 'write', routes: [{ via: 'dash', method: 'PATCH', path: `${K}/tasks/{task_id}` }] },
    comment: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks/{task_id}/comments` }] },
    specify: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks/{task_id}/specify` }] },
    decompose: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/tasks/{task_id}/decompose` }] },
    link: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/links` }] },
    unlink: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: `${K}/links` }] },
    dispatch: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/dispatch` }] },
    setOrchestration: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: `${K}/orchestration` }] },
    terminate: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: `${K}/runs/{run_id}/terminate` }] },
  },
};
