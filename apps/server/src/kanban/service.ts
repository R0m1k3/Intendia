import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import type { CompatService } from '../compat/service.js';
import {
  AssigneesSchema, BoardListSchema, BoardSchema, OrchestrationSchema, TaskDetailSchema, TaskLogSchema, TaskSchema, WorkersSchema, WorkflowSchema,
  type HermesTask,
} from '../connectors/kanban/index.js';
import { callOp, HermesError, hermesDetail, ModuleUnavailableError, streamOp, type CallOptions } from '../connectors/runtime.js';
import { Masker } from '../hermes-config/mask.js';
import type { InstanceStore } from '../instances/store.js';
import { blockLines, folderKey, frame, unframe } from '../workspaces/framing.js';
import { NotFoundError, ValidationError, type Workspace, type WorkspaceService } from '../workspaces/service.js';

/** 409 from Hermes, or a kanban state Intendia reports with its own code. */
export class KanbanError extends Error {
  constructor(
    readonly code: 'hermes_conflict' | 'worker_ended' | 'task_restarted' | 'board_exists' | 'aux_failed'
      | 'mission_state' | 'mission_dependency' | 'mission_last',
    message: string,
    readonly status: 409 | 422 = 409,
  ) {
    super(message);
  }
}

export const LIMITS = { title: 200, body: 20_000, comment: 10_000, blockReason: 500, boardName: 100 } as const;
/**
 * `scheduled` is the only state Hermes leaves alone (out only by an explicit unblock: a move to ready);
 * `ready` is launched by the dispatcher once it has an agent; `triage` is split by the gateway when an auxiliary
 * model is set (`auto_decompose`). Not `todo`: Hermes promotes a todo task to ready as soon as its parents are
 * done (`recompute_ready`). A task without an agent is never launched.
 */
export const START_STATES = ['scheduled', 'ready', 'triage'] as const;
export type StartState = (typeof START_STATES)[number];
const DISPATCH_MAX = 8;
const LOG_TAIL = 200;

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

export interface TaskWorkspace { slug: string; name: string; folder: string }

export interface PublicTask {
  id: string;
  title: string;
  status: string;
  /** body without the framing block */
  body: string;
  assignee: string | null;
  priority: number | null;
  commentCount: number;
  parents: number;
  children: number;
  progress: { done: number; total: number } | null;
  runId: number | null;
  error: string | null;
  summary: string | null;
  workspace: TaskWorkspace | null;
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface PublicColumn { key: string; label: string; dragTarget: boolean; tasks: PublicTask[] }

export interface TaskDetail {
  task: PublicTask;
  blockReason: string | null;
  comments: { id: number; author: string | null; body: string; createdAt: number | null }[];
  events: { id: number; kind: string; createdAt: number | null }[];
  attachments: { id: number; filename: string; size: number | null; contentType: string | null }[];
  parents: { id: string; title: string | null; status: string | null }[];
  children: { id: string; title: string | null; status: string | null }[];
  runs: { id: number; profile: string | null; status: string | null; outcome: string | null; startedAt: number | null; endedAt: number | null; error: string | null; summary: string | null }[];
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

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function textLimit(value: string | undefined, max: number, what: string): void {
  if (value !== undefined && value.length > max) throw new ValidationError(`${what} trop long (${max} caractères au plus)`);
}

/** Is `path` inside `root`, by path segments (`/vol/a` does not hold `/vol/ab/x`)? */
export function underPath(root: string, path: string): boolean {
  const r = posix.normalize(root).replace(/\/+$/, '');
  const p = posix.normalize(path);
  return p === r || p.startsWith(`${r}/`);
}

/**
 * Kanban plugin of an instance. Shared by every Hermes profile: no `?profile=`; every board call
 * names its board, never the global "current board".
 */
export class KanbanService {
  private readonly mask: Masker;

  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    private readonly workspaces: WorkspaceService,
    secret: string,
  ) {
    this.mask = new Masker(secret);
  }

  private check(instanceId: string): void {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
  }

  private call<T = unknown>(instanceId: string, op: string, opts: CallOptions = {}, what?: string): Promise<T> {
    this.check(instanceId);
    return translate(() => callOp<T>(this.compat.http(instanceId), this.compat.get(instanceId), 'kanban', op, opts), what);
  }

  private onBoard<T = unknown>(instanceId: string, board: string, op: string, opts: CallOptions = {}, what?: string): Promise<T> {
    return this.call<T>(instanceId, op, { ...opts, query: { ...(opts.query ?? {}), board } }, what);
  }

  assertInstance(instanceId: string): void {
    this.check(instanceId);
  }

  /** Throws like a call would (409 without code) when one of the ops is missing on the instance. */
  requireOps(instanceId: string, ops: string[]): void {
    this.check(instanceId);
    const mod = this.compat.get(instanceId)?.modules.find((m) => m.id === 'kanban');
    for (const op of ops) {
      if (!this.can(instanceId, op)) throw new ModuleUnavailableError('kanban', op, mod?.ops[op]?.notes ?? ['pas encore vérifié']);
    }
  }

  /** Is the operation usable on this instance (last compatibility report)? */
  can(instanceId: string, op: string): boolean {
    const mod = this.compat.get(instanceId)?.modules.find((m) => m.id === 'kanban');
    return Boolean(mod && mod.state !== 'unavailable' && mod.ops[op]?.ok);
  }

  // ---------------------------------------------------------------- workspaces

  private instanceWorkspaces(instanceId: string): Workspace[] {
    return this.workspaces.listWorkspaces().filter((w) => w.instanceId === instanceId);
  }

  /** Workspace whose agent path holds the task's folder (by path segments). */
  private workspaceOf(instanceId: string, path: string | null | undefined, list = this.instanceWorkspaces(instanceId)): TaskWorkspace | null {
    if (!path || !path.startsWith('/')) return null;
    for (const ws of list) {
      const root = this.workspaces.agentPath(ws);
      if (!underPath(root, path)) continue;
      const rel = posix.normalize(path).slice(root.replace(/\/+$/, '').length).replace(/^\/+/, '');
      return { slug: ws.slug, name: ws.name, folder: rel };
    }
    return null;
  }

  private toPublic(instanceId: string, t: HermesTask, list?: Workspace[]): PublicTask {
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      body: unframe(t.body ?? '', 'kanban').prompt,
      assignee: t.assignee ?? null,
      priority: t.priority ?? null,
      commentCount: t.comment_count ?? 0,
      parents: t.link_counts?.parents ?? 0,
      children: t.link_counts?.children ?? 0,
      progress: t.progress ?? null,
      runId: num(t.current_run_id),
      error: t.last_failure_error ? this.mask.text(t.last_failure_error) : null,
      summary: t.latest_summary ? this.mask.text(t.latest_summary) : null,
      workspace: t.workspace_kind === 'dir' ? this.workspaceOf(instanceId, t.workspace_path, list) : null,
      createdAt: t.created_at ?? null,
      startedAt: t.started_at ?? null,
      completedAt: t.completed_at ?? null,
    };
  }

  // ---------------------------------------------------------------- reads

  async boards(instanceId: string): Promise<PublicBoard[]> {
    const raw = BoardListSchema.parse(await this.call(instanceId, 'boards'));
    return raw.boards.filter((b) => !b.archived).map((b) => ({ slug: b.slug, name: b.name || b.slug, total: b.total ?? 0 }));
  }

  async workflow(instanceId: string): Promise<{ columns: { key: string; label: string; dragTarget: boolean }[]; manual: Record<string, string[]> }> {
    const raw = WorkflowSchema.parse(await this.call(instanceId, 'workflow'));
    return {
      columns: raw.columns.map((c) => ({ key: c.key, label: c.label ?? c.key, dragTarget: c.drag_target ?? true })),
      manual: raw.manual ?? {},
    };
  }

  /** Columns in the workflow order (statuses Hermes adds later go at the end), tasks unframed. */
  async board(instanceId: string, board: string): Promise<{ board: string; columns: PublicColumn[]; latestEventId: number | null }> {
    const [rawBoard, flow] = await Promise.all([
      this.onBoard(instanceId, board, 'board', {}, 'Tableau introuvable').then((r) => BoardSchema.parse(r)),
      this.workflow(instanceId),
    ]);
    const list = this.instanceWorkspaces(instanceId);
    const byName = new Map(rawBoard.columns.map((c) => [c.name, c.tasks]));
    const columns: PublicColumn[] = flow.columns.map((c) => ({
      ...c, tasks: (byName.get(c.key) ?? []).map((t) => this.toPublic(instanceId, t, list)),
    }));
    for (const c of rawBoard.columns) {
      if (!flow.columns.some((f) => f.key === c.name) && c.tasks.length) {
        columns.push({ key: c.name, label: c.name, dragTarget: false, tasks: c.tasks.map((t) => this.toPublic(instanceId, t, list)) });
      }
    }
    return { board, columns, latestEventId: rawBoard.latest_event_id ?? null };
  }

  async assignees(instanceId: string): Promise<string[]> {
    return AssigneesSchema.parse(await this.call(instanceId, 'assignees')).assignees.map((a) => a.name);
  }

  async orchestration(instanceId: string) {
    const o = OrchestrationSchema.parse(await this.call(instanceId, 'orchestration'));
    return {
      orchestratorProfile: o.orchestrator_profile || null,
      defaultAssignee: o.default_assignee || null,
      autoDecompose: o.auto_decompose ?? false,
      autoPromoteChildren: o.auto_promote_children ?? false,
      activeProfile: o.active_profile ?? null,
    };
  }

  async task(instanceId: string, board: string, taskId: string): Promise<TaskDetail> {
    const d = TaskDetailSchema.parse(await this.onBoard(instanceId, board, 'task', { params: { task_id: taskId } }, 'Tâche introuvable'));
    const linked = new Map((d.link_tasks ?? []).map((t) => [t.id, t]));
    const side = (ids: string[] | undefined) => (ids ?? []).map((id) => ({ id, title: linked.get(id)?.title ?? null, status: linked.get(id)?.status ?? null }));
    return {
      task: this.toPublic(instanceId, d.task),
      // Hermes 0.23 keeps no block_reason column: the reason of a block / schedule is the summary of the run it writes
      blockReason: d.task.status === 'blocked' || d.task.status === 'scheduled'
        ? str(d.task.block_reason) ?? (str(d.task.latest_summary) && this.mask.text(d.task.latest_summary as string)) : str(d.task.block_reason),
      comments: (d.comments ?? []).map((c) => ({ id: num(c.id) ?? 0, author: c.author ?? null, body: c.body, createdAt: c.created_at ?? null })),
      events: (d.events ?? []).slice(-50).map((e) => ({ id: num(e.id) ?? 0, kind: e.kind, createdAt: e.created_at ?? null })),
      attachments: (d.attachments ?? []).map((a) => ({
        id: num(a.id) ?? 0, filename: str(a.filename) ?? `piece-${String(a.id)}`, size: num(a.size), contentType: str(a.content_type),
      })),
      parents: side(d.links?.parents),
      children: side(d.links?.children),
      runs: (d.runs ?? []).map((r) => ({
        id: num(r.id) ?? 0, profile: str(r.profile), status: str(r.status), outcome: str(r.outcome),
        startedAt: num(r.started_at), endedAt: num(r.ended_at),
        error: str(r.error) && this.mask.text(r.error as string), summary: str(r.summary) && this.mask.text(r.summary as string),
      })),
    };
  }

  /** Last 200 lines of the worker log, secrets masked. */
  async log(instanceId: string, board: string, taskId: string): Promise<{ content: string; exists: boolean; truncated: boolean }> {
    const raw = TaskLogSchema.parse(await this.onBoard(instanceId, board, 'log', { params: { task_id: taskId }, query: { tail: String(LOG_TAIL * 400) } }, 'Tâche introuvable'));
    const lines = (raw.content ?? '').split('\n');
    const cut = lines.length > LOG_TAIL;
    return { content: this.mask.text(lines.slice(-LOG_TAIL).join('\n')), exists: raw.exists ?? Boolean(raw.content), truncated: cut || Boolean(raw.truncated) };
  }

  /** Raw Hermes response of an attachment (the route relays it as a download). */
  async attachment(instanceId: string, board: string, attachmentId: number): Promise<Response> {
    this.check(instanceId);
    const res = await streamOp(this.compat.http(instanceId), this.compat.get(instanceId), 'kanban', 'attachment', {
      params: { attachment_id: String(attachmentId) }, query: { board },
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      if (res.status === 404) throw new NotFoundError('Pièce jointe introuvable');
      throw new HermesError('http', `Hermes a répondu ${res.status}`, { status: res.status });
    }
    return res;
  }

  /** Active workers of every live board of the instance. */
  async workers(instanceId: string): Promise<PublicWorker[]> {
    const boards = await this.boards(instanceId);
    const lists = await Promise.all(boards.map(async (b) => {
      const raw = WorkersSchema.parse(await this.onBoard(instanceId, b.slug, 'workers', {}, 'Tableau introuvable'));
      return raw.workers.map((w) => ({
        instance: instanceId, board: b.slug, runId: w.run_id, taskId: w.task_id, taskTitle: w.task_title ?? null,
        assignee: w.task_assignee ?? w.profile ?? null, startedAt: w.started_at ?? null,
      }));
    }));
    return lists.flat();
  }

  // ---------------------------------------------------------------- writes

  async createBoard(instanceId: string, input: { slug: string; name?: string }): Promise<PublicBoard> {
    textLimit(input.name, LIMITS.boardName, 'Nom du tableau');
    // Hermes returns the existing board for a known slug: say it instead
    const existing = BoardListSchema.parse(await this.call(instanceId, 'boards')).boards;
    if (existing.some((b) => b.slug === input.slug)) throw new KanbanError('board_exists', `Le tableau ${input.slug} existe déjà`);
    const name = input.name?.trim() || input.slug;
    await this.call(instanceId, 'createBoard', { body: { slug: input.slug, name } });
    return { slug: input.slug, name, total: 0 };
  }

  async createTask(instanceId: string, board: string, input: {
    title: string; body?: string; assignee?: string | null; priority?: number | null; start?: StartState; workspace?: string | null;
  }): Promise<PublicTask> {
    const title = input.title.trim();
    if (!title) throw new ValidationError('Titre manquant');
    textLimit(title, LIMITS.title, 'Titre');
    textLimit(input.body, LIMITS.body, 'Texte');
    const start = input.start ?? 'scheduled';
    const body: Record<string, unknown> = { title, triage: start === 'triage' };
    // scheduled: created ready without agent (the dispatcher skips it), parked, then given its agent
    if (input.assignee && start !== 'scheduled') body.assignee = input.assignee;
    if (input.priority !== undefined && input.priority !== null) body.priority = input.priority;
    let text = input.body ?? '';
    if (input.workspace) {
      const ws = this.workspaces.getWorkspace(input.workspace);
      if (ws.instanceId !== instanceId) throw new ValidationError(`Le workspace ${ws.slug} appartient à une autre instance`);
      const key = `${folderKey(title, [], 'tache')}-${randomBytes(2).toString('hex')}`;
      const path = `${this.workspaces.agentPath(ws)}/kanban/${key}`;
      text = frame(text, blockLines(ws, 'kanban', key, this.workspaces.framingLines(ws, `kanban/${key}`), this.workspaces.agentPath(ws)));
      body.workspace_kind = 'dir';
      body.workspace_path = path;
    }
    if (text) body.body = text;
    const res = await this.onBoard<{ task?: unknown }>(instanceId, board, 'createTask', { body }, 'Tableau introuvable');
    let task = TaskSchema.parse(res.task);
    if (start === 'scheduled') {
      const patch = async (b: Record<string, unknown>) => TaskSchema.parse((await this.onBoard<{ task?: unknown }>(
        instanceId, board, 'updateTask', { params: { task_id: task.id }, body: b }, 'Tâche introuvable')).task);
      task = await patch({ status: 'scheduled' });
      if (input.assignee) task = await patch({ assignee: input.assignee });
    }
    return this.toPublic(instanceId, task);
  }

  /** Allowed fields only; a new body keeps the framing block of the current one. */
  async updateTask(instanceId: string, board: string, taskId: string, input: {
    status?: string; assignee?: string | null; priority?: number | null; title?: string; body?: string; blockReason?: string;
  }): Promise<PublicTask> {
    textLimit(input.title, LIMITS.title, 'Titre');
    textLimit(input.body, LIMITS.body, 'Texte');
    textLimit(input.blockReason, LIMITS.blockReason, 'Raison');
    const patch: Record<string, unknown> = {};
    if (input.status !== undefined) patch.status = input.status;
    if (input.assignee !== undefined) patch.assignee = input.assignee;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.title !== undefined) {
      if (!input.title.trim()) throw new ValidationError('Titre manquant');
      patch.title = input.title.trim();
    }
    if (input.blockReason !== undefined) patch.block_reason = input.blockReason;
    if (input.body !== undefined) {
      const current = TaskDetailSchema.parse(await this.onBoard(instanceId, board, 'task', { params: { task_id: taskId } }, 'Tâche introuvable')).task.body ?? '';
      const kept = current.slice(0, current.length - unframe(current, 'kanban').prompt.length);
      patch.body = `${kept}${input.body}`;
    }
    if (!Object.keys(patch).length) throw new ValidationError('Rien à modifier');
    const res = await this.onBoard<{ task?: unknown }>(instanceId, board, 'updateTask', { params: { task_id: taskId }, body: patch }, 'Tâche introuvable');
    return this.toPublic(instanceId, TaskSchema.parse(res.task));
  }

  async comment(instanceId: string, board: string, taskId: string, text: string): Promise<{ ok: true }> {
    if (!text.trim()) throw new ValidationError('Commentaire vide');
    textLimit(text, LIMITS.comment, 'Commentaire');
    await this.onBoard(instanceId, board, 'comment', { params: { task_id: taskId }, body: { body: text, author: 'intendia' } }, 'Tâche introuvable');
    return { ok: true };
  }

  /** specify / decompose: an auxiliary model at Hermes; `{ok: false, reason}` is a 422 aux_failed. */
  async aux(instanceId: string, board: string, taskId: string, op: 'specify' | 'decompose', opts: { timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    const res = await this.onBoard<Record<string, unknown>>(instanceId, board, op, {
      params: { task_id: taskId }, body: { author: 'intendia' }, timeoutMs: opts.timeoutMs ?? 120_000,
    }, 'Tâche introuvable');
    if (res.ok === false) throw new KanbanError('aux_failed', `Hermes n’a pas pu le faire : ${this.mask.text(String(res.reason ?? 'raison inconnue'))}`, 422);
    return res;
  }

  async link(instanceId: string, board: string, parent: string, child: string): Promise<{ ok: true }> {
    if (parent === child) throw new ValidationError('Une tâche ne peut pas dépendre d’elle-même');
    await this.onBoard(instanceId, board, 'link', { body: { parent_id: parent, child_id: child } }, 'Tâche introuvable');
    return { ok: true };
  }

  async unlink(instanceId: string, board: string, parent: string, child: string): Promise<{ ok: true }> {
    await this.onBoard(instanceId, board, 'unlink', { query: { parent_id: parent, child_id: child } }, 'Lien introuvable');
    return { ok: true };
  }

  async dispatch(instanceId: string, board: string, dryRun: boolean): Promise<{ spawned: { taskId: string; assignee: string | null }[]; skippedUnassigned: string[]; dryRun: boolean }> {
    const res = await this.onBoard<Record<string, unknown>>(instanceId, board, 'dispatch', {
      query: { dry_run: dryRun ? 'true' : 'false', max: String(DISPATCH_MAX) },
    }, 'Tableau introuvable');
    const spawned = Array.isArray(res.spawned) ? res.spawned : [];
    return {
      spawned: spawned.map((s) => (Array.isArray(s) ? { taskId: String(s[0]), assignee: str(s[1]) } : { taskId: String(s), assignee: null })),
      skippedUnassigned: Array.isArray(res.skipped_unassigned) ? res.skipped_unassigned.map(String) : [],
      dryRun,
    };
  }

  /**
   * Stops a worker. Hermes' terminate puts the task back in `ready` (the dispatcher would relaunch it)
   * or `review`; a `ready` task is then blocked so that it stays stopped.
   */
  async stopWorker(instanceId: string, board: string, runId: number): Promise<{ taskId: string; status: string }> {
    let taskId: string;
    try {
      const res = await this.onBoard<{ task_id?: string }>(instanceId, board, 'terminate', {
        params: { run_id: String(runId) }, body: { reason: 'Arrêté depuis Intendia' },
      }, 'Worker introuvable');
      taskId = String(res.task_id ?? '');
    } catch (err) {
      // 409: the run already ended; 404: Hermes does not know it (anymore). Either way nothing runs.
      if (err instanceof KanbanError || err instanceof NotFoundError) throw new KanbanError('worker_ended', 'Ce worker est déjà terminé');
      throw err;
    }
    if (!taskId) return { taskId: '', status: 'unknown' };
    const detail = TaskDetailSchema.parse(await this.onBoard(instanceId, board, 'task', { params: { task_id: taskId } }, 'Tâche introuvable'));
    if (detail.task.status !== 'ready') return { taskId, status: detail.task.status };
    try {
      await this.onBoard(instanceId, board, 'updateTask', {
        params: { task_id: taskId }, body: { status: 'blocked', block_reason: 'Arrêtée depuis Intendia' },
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
