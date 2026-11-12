import type { CompatService } from '../compat/service.js';
import { RunStatusSchema, TERMINAL_STATUSES, type PendingControl } from '../connectors/chat/index.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import type { KanbanService, PublicWorker } from '../kanban/service.js';
import { NotFoundError, type WorkspaceService } from '../workspaces/service.js';
import { pendingFromStatus, readApproval } from './approvals.js';

const WINDOW_MS = 24 * 3600_000;
const MAX_CANDIDATES = 20;
/** sessions in « Sans confirmation » read per pass */
const AUTO_APPROVE_CANDIDATES = 200;
const PARALLEL = 4;
const TIMEOUT_MS = 3_000;
const DONE_MAX = 1000;

export interface ActiveRun {
  instance: string;
  workspace: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  status: string;
  profile: string;
  lastActiveAt: number;
}

/** A run as read by `running()`: with the questions listed in its status (never sent to the page). */
export type CheckedRun = ActiveRun & { controls: PendingControl[] };

/** A run waiting for approval, with its question when it could be read. */
export interface PendingApproval {
  key: string;
  instanceId: string;
  instanceLabel: string;
  workspace: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  /** approval: allow a command; clarify: a question of the agent, answered with text. */
  kind: 'approval' | 'clarify';
  requestId: string | null;
  question: string | null;
  multiSelect: boolean;
  command: string | null;
  description: string | null;
  choices: string[];
  /** The instance can answer (module chat, op approval or clarify). */
  canAnswer: boolean;
}

/** How long an approvals result is shared between callers (several tabs poll it). */
const APPROVALS_TTL_MS = 5_000;

export interface Activity {
  runs: ActiveRun[];
  workers: PublicWorker[];
  errors: { instance: string; message: string }[];
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * Runs in progress launched from Intendia (the API server has no run list: the last run of each
 * session that was active in the last 24 h) and active kanban workers, across instances.
 */
export class ActivityService {
  /** Run ids already seen finished (or forgotten by Hermes): never asked again. Lost on restart. */
  private readonly done = new Set<string>();

  constructor(
    private readonly compat: CompatService,
    private readonly store: InstanceStore,
    private readonly workspaces: WorkspaceService,
    private readonly kanban: KanbanService,
  ) {}

  private markDone(key: string) {
    if (this.done.size >= DONE_MAX) this.done.delete(this.done.values().next().value!);
    this.done.add(key);
  }

  /** The last run of each recent session, still going (one instance, or all); errors go to `fail`. */
  private async running(
    now: number, instanceId: string | undefined, fail: (instance: string, err: unknown) => void,
    opts: { onlyAutoApprove?: boolean; limit?: number } = {},
  ): Promise<CheckedRun[]> {
    const known = new Set(this.store.list().map((i) => i.id).filter((id) => instanceId === undefined || id === instanceId));
    // finished runs are skipped before the limit, so an older run still going is reached
    const candidates = this.workspaces.recentRuns(now - WINDOW_MS, opts.limit ?? MAX_CANDIDATES,
      (r) => known.has(r.instanceId) && !this.done.has(`${r.instanceId}:${r.runId}`) && (!opts.onlyAutoApprove || r.autoApprove));

    const checked = await inBatches(candidates, PARALLEL, async (c): Promise<CheckedRun | null> => {
      const key = `${c.instanceId}:${c.runId}`;
      try {
        const raw = await callOp<unknown>(this.compat.http(c.instanceId), this.compat.get(c.instanceId), 'chat', 'runStatus', {
          params: { run_id: c.runId }, profile: c.profile, timeoutMs: TIMEOUT_MS,
        });
        const { status, pending_controls: controls } = RunStatusSchema.parse(raw);
        if (TERMINAL_STATUSES.includes(status) || status === 'unknown') {
          this.markDone(key);
          return null;
        }
        return {
          instance: c.instanceId, workspace: c.workspaceSlug, workspaceName: c.workspaceName, sessionId: c.sessionId,
          title: c.title, runId: c.runId, status, profile: c.profile, lastActiveAt: c.lastActiveAt, controls,
        };
      } catch (err) {
        // Hermes keeps runs in memory: a 404 means it restarted, the run is over
        if (err instanceof HermesError && err.kind === 'http' && err.detail.status === 404) this.markDone(key);
        else fail(c.instanceId, err);
        return null;
      }
    });
    return checked.filter((r): r is CheckedRun => r !== null);
  }

  /** Runs still going of the sessions in « Sans confirmation » (AutoApprover), with their status read. */
  autoApproveRuns(now: number, fail: (instance: string, err: unknown) => void): Promise<CheckedRun[]> {
    return this.running(now, undefined, fail, { onlyAutoApprove: true, limit: AUTO_APPROVE_CANDIDATES });
  }

  /** Runs in progress and kanban workers of one instance. */
  async list(instanceId: string, now = Date.now()): Promise<Activity> {
    if (!this.store.get(instanceId)) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    const errors: Activity['errors'] = [];
    const fail = (instance: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!errors.some((e) => e.instance === instance && e.message === message)) errors.push({ instance, message });
    };
    const runs: ActiveRun[] = (await this.running(now, instanceId, fail)).map(({ controls: _controls, ...r }) => r);

    const workers: PublicWorker[] = [];
    for (const inst of this.store.list().filter((i) => i.id === instanceId)) {
      if (!this.kanban.can(inst.id, 'workers') || !this.kanban.can(inst.id, 'boards')) continue;
      try {
        workers.push(...(await this.kanban.workers(inst.id)));
      } catch (err) {
        fail(inst.id, err);
      }
    }
    return { runs, workers, errors };
  }

  private shared: { at: number; result: Promise<{ approvals: PendingApproval[] }> } | null = null;

  /**
   * Runs of every instance waiting for approval, with their question (read again each time: a run can ask twice).
   * One computation at a time, its result shared for a few seconds.
   */
  approvals(now = Date.now()): Promise<{ approvals: PendingApproval[] }> {
    if (this.shared && now - this.shared.at < APPROVALS_TTL_MS) return this.shared.result;
    const result = this.computeApprovals(now).catch((err) => {
      this.shared = null;
      throw err;
    });
    this.shared = { at: now, result };
    return result;
  }

  private async computeApprovals(now: number): Promise<{ approvals: PendingApproval[] }> {
    // a run waiting for a question of the agent stays `running`: it is found by the questions listed in its status
    const waiting = (await this.running(now, undefined, () => {}))
      .filter((r) => r.status === 'waiting_for_approval' || r.controls.some((p) => p.kind === 'clarify' && p.prompt_id));
    const approvals = await inBatches(waiting, PARALLEL, async (r): Promise<PendingApproval> => {
      const report = this.compat.get(r.instance);
      // the status already read lists the question (gateway session authority); else it is read in the run's events
      const q = pendingFromStatus(r.runId, r.controls) ?? await readApproval(this.compat, r.instance, r.runId, r.profile);
      const kind = q?.kind ?? 'approval';
      const canAnswer = Boolean(report?.modules.find((m) => m.id === 'chat')?.ops[kind]?.ok);
      return {
        key: q?.key ?? `${r.runId}:attente`, instanceId: r.instance, instanceLabel: this.store.get(r.instance)?.label ?? r.instance,
        workspace: r.workspace, workspaceName: r.workspaceName, sessionId: r.sessionId, title: r.title, runId: r.runId,
        kind, requestId: q?.requestId ?? null, question: q?.question ?? null, multiSelect: q?.multiSelect ?? false, command: q?.command ?? null, description: q?.description ?? null,
        choices: q?.choices ?? [], canAnswer,
      };
    });
    return { approvals };
  }
}
