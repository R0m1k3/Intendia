import type { CompatService } from '../compat/service.js';
import { RunStatusSchema, TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import type { InstanceStore } from '../instances/store.js';
import type { KanbanService, PublicWorker } from '../kanban/service.js';
import type { WorkspaceService } from '../workspaces/service.js';

const WINDOW_MS = 24 * 3600_000;
const MAX_CANDIDATES = 20;
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

  async list(now = Date.now()): Promise<Activity> {
    const errors: Activity['errors'] = [];
    const fail = (instance: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!errors.some((e) => e.instance === instance && e.message === message)) errors.push({ instance, message });
    };
    const known = new Set(this.store.list().map((i) => i.id));
    const candidates = this.workspaces.recentRuns(now - WINDOW_MS, MAX_CANDIDATES)
      .filter((r) => known.has(r.instanceId) && !this.done.has(`${r.instanceId}:${r.runId}`));

    const checked = await inBatches(candidates, PARALLEL, async (c): Promise<ActiveRun | null> => {
      const key = `${c.instanceId}:${c.runId}`;
      try {
        const raw = await callOp<unknown>(this.compat.http(c.instanceId), this.compat.get(c.instanceId), 'chat', 'runStatus', {
          params: { run_id: c.runId }, profile: c.profile, timeoutMs: TIMEOUT_MS,
        });
        const { status } = RunStatusSchema.parse(raw);
        if (TERMINAL_STATUSES.includes(status) || status === 'unknown') {
          this.markDone(key);
          return null;
        }
        return {
          instance: c.instanceId, workspace: c.workspaceSlug, workspaceName: c.workspaceName, sessionId: c.sessionId,
          title: c.title, runId: c.runId, status, profile: c.profile, lastActiveAt: c.lastActiveAt,
        };
      } catch (err) {
        // Hermes keeps runs in memory: a 404 means it restarted, the run is over
        if (err instanceof HermesError && err.kind === 'http' && err.detail.status === 404) this.markDone(key);
        else fail(c.instanceId, err);
        return null;
      }
    });

    const workers: PublicWorker[] = [];
    for (const inst of this.store.list()) {
      if (!this.kanban.can(inst.id, 'workers') || !this.kanban.can(inst.id, 'boards')) continue;
      try {
        workers.push(...(await this.kanban.workers(inst.id)));
      } catch (err) {
        fail(inst.id, err);
      }
    }
    return { runs: checked.filter((r): r is ActiveRun => r !== null), workers, errors };
  }
}
