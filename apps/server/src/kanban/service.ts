import type { CompatService } from '../compat/service.js';
import { BoardListSchema, TaskDetailSchema, WorkersSchema } from '../connectors/kanban/index.js';
import { callOp, HermesError, hermesDetail, type CallOptions } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';

/** 409 from Hermes, or a kanban state Intendia reports with its own code. */
export class KanbanError extends Error {
  constructor(readonly code: 'hermes_conflict' | 'worker_ended' | 'task_restarted', message: string) {
    super(message);
  }
}

export interface PublicBoard { slug: string; name: string; total: number }

export interface PublicWorker {
  instance: string;
  board: string;
  runId: number;
  taskId: string;
  taskTitle: string | null;
  assignee: string | null;
  startedAt: number | null;
}

/** Hermes kanban errors → Intendia errors; Hermes' own text is kept (its rules are not copied here). */
async function translate<T>(fn: () => Promise<T>, what = 'Introuvable'): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HermesError && err.kind === 'http') {
      const status = err.detail.status;
      if (status === 404) throw new NotFoundError(`${what} : ${hermesDetail(err)}`);
      if (status === 400 || status === 422) throw new ValidationError(`Refusé par Hermes : ${hermesDetail(err)}`);
      if (status === 409) throw new KanbanError('hermes_conflict', `Refusé par Hermes : ${hermesDetail(err)}`);
    }
    throw err;
  }
}

/**
 * Kanban plugin of an instance. Shared by every Hermes profile: no `?profile=`; every board call
 * names its board, never the global "current board".
 */
export class KanbanService {
  constructor(private readonly compat: CompatService, private readonly store: InstanceStore) {}

  private call<T = unknown>(instanceId: string, op: string, opts: CallOptions = {}, what?: string): Promise<T> {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    return translate(() => callOp<T>(this.compat.http(instanceId), this.compat.get(instanceId), 'kanban', op, opts), what);
  }

  /** Is the operation usable on this instance (last compatibility report)? */
  can(instanceId: string, op: string): boolean {
    const mod = this.compat.get(instanceId)?.modules.find((m) => m.id === 'kanban');
    return Boolean(mod && mod.state !== 'unavailable' && mod.ops[op]?.ok);
  }

  async boards(instanceId: string): Promise<PublicBoard[]> {
    const raw = BoardListSchema.parse(await this.call(instanceId, 'boards'));
    return raw.boards.filter((b) => !b.archived).map((b) => ({ slug: b.slug, name: b.name || b.slug, total: b.total ?? 0 }));
  }

  /** Active workers of every live board of the instance. */
  async workers(instanceId: string): Promise<PublicWorker[]> {
    const boards = await this.boards(instanceId);
    const lists = await Promise.all(boards.map(async (b) => {
      const raw = WorkersSchema.parse(await this.call(instanceId, 'workers', { query: { board: b.slug } }, 'Tableau introuvable'));
      return raw.workers.map((w) => ({
        instance: instanceId, board: b.slug, runId: w.run_id, taskId: w.task_id, taskTitle: w.task_title ?? null,
        assignee: w.task_assignee ?? w.profile ?? null, startedAt: w.started_at ?? null,
      }));
    }));
    return lists.flat();
  }

  /**
   * Stops a worker. Hermes' terminate puts the task back in `ready` (the dispatcher would relaunch it)
   * or `review`; a `ready` task is then blocked so that it stays stopped.
   */
  async stopWorker(instanceId: string, board: string, runId: number): Promise<{ taskId: string; status: string }> {
    let taskId: string;
    try {
      const res = await this.call<{ task_id?: string }>(instanceId, 'terminate', {
        params: { run_id: String(runId) }, query: { board }, body: { reason: 'Arrêté depuis Intendia' },
      }, 'Worker introuvable');
      taskId = String(res.task_id ?? '');
    } catch (err) {
      if (err instanceof KanbanError) throw new KanbanError('worker_ended', 'Worker déjà terminé');
      throw err;
    }
    if (!taskId) return { taskId: '', status: 'unknown' };
    const detail = TaskDetailSchema.parse(await this.call(instanceId, 'task', { params: { task_id: taskId }, query: { board } }, 'Tâche introuvable'));
    if (detail.task.status !== 'ready') return { taskId, status: detail.task.status };
    try {
      await this.call(instanceId, 'updateTask', {
        params: { task_id: taskId }, query: { board }, body: { status: 'blocked', block_reason: 'Arrêtée depuis Intendia' },
      }, 'Tâche introuvable');
    } catch (err) {
      if (err instanceof ValidationError || err instanceof KanbanError) {
        throw new KanbanError('task_restarted', 'La tâche a été relancée par Hermes avant d’être bloquée');
      }
      throw err;
    }
    return { taskId, status: 'blocked' };
  }
}
