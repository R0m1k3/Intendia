import { randomBytes } from 'node:crypto';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { kanbanMissions } from '../db/schema.js';
import { HermesError } from '../connectors/runtime.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';
import { KanbanError, LIMITS, type KanbanService, type TaskDetail } from './service.js';

/**
 * Supervised missions (lot 9 C): a goal becomes a root task in triage that Hermes splits (`decompose`) into
 * 2-6 children, the root's parents. Intendia parks every child in `scheduled` (the only state Hermes' dispatcher
 * never touches) with HOLD_REASON, lets the user review them, then moves them to `ready`. The row in
 * `kanban_missions` is only a pointer: which children are held is read at Hermes (status + `latest_summary`).
 */
export const HOLD_REASON = 'Mission à valider dans Intendia';
export const MISSION_STATES = ['decomposing', 'held', 'launched', 'failed', 'cancelled'] as const;
export type MissionState = (typeof MISSION_STATES)[number];
/** Hermes may still finish a split whose answer Intendia lost: the root is re-read until then. */
export const SETTLE_MS = 210_000;
const SETTLE_EVERY_MS = 10_000;
const DECOMPOSE_TIMEOUT_MS = 190_000;
const HELD_STATES = new Set(['todo', 'ready']);
const HOLD_TRIES = 3;
const HOLD_RETRY_MS = 1000;
/** checked before anything is written: the split runs detached, a missing op would only show later */
const MISSION_OPS = ['createTask', 'decompose', 'task', 'updateTask', 'dispatch', 'workers'];

export interface MissionRow {
  id: string; instanceId: string; board: string; rootId: string | null; goal: string; state: MissionState;
  error: string | null; decomposeStartedAt: number | null; createdAt: number; updatedAt: number;
}

export interface MissionChild {
  id: string; title: string; body: string; status: string; assignee: string | null;
  /** ids of the other children it waits for */
  after: string[];
  held: boolean;
  /** held at Hermes but a worker runs it: Hermes closed the run without stopping the worker */
  lostTracking: boolean;
}

export interface Mission extends MissionRow {
  rootStatus: string | null;
  children: MissionChild[];
}

export interface MissionDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MissionService {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  /** detached work per mission (decompose / settle), awaited by the tests */
  private readonly jobs = new Map<string, Promise<void>>();
  /** one action at a time per mission (launch, cancel, remove): two tabs, or a double click */
  private readonly acting = new Set<string>();

  constructor(private readonly db: Db, private readonly kanban: KanbanService, deps: MissionDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? realSleep;
    this.log = deps.log ?? ((m) => console.warn(`[intendia] mission: ${m}`));
  }

  // ---------------------------------------------------------------- rows

  private row(instanceId: string, id: string): MissionRow {
    const r = this.db.select().from(kanbanMissions).where(and(eq(kanbanMissions.id, id), eq(kanbanMissions.instanceId, instanceId))).get();
    if (!r) throw new NotFoundError('Mission introuvable');
    return r as MissionRow;
  }

  private set(id: string, patch: Partial<Omit<MissionRow, 'id'>>): void {
    this.db.update(kanbanMissions).set({ ...patch, updatedAt: this.now() }).where(eq(kanbanMissions.id, id)).run();
  }

  private stateOf(id: string): MissionState | null {
    return (this.db.select({ s: kanbanMissions.state }).from(kanbanMissions).where(eq(kanbanMissions.id, id)).get()?.s as MissionState) ?? null;
  }

  private detach(id: string, work: () => Promise<void>): void {
    if (this.jobs.has(id)) return;
    const job = work().catch((err: unknown) => {
      this.log(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      if (this.stateOf(id) === 'decomposing') this.set(id, { state: 'failed', error: 'Erreur inattendue pendant le découpage' });
    }).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
  }

  /** Tests: resolves when the detached work of a mission is over. */
  async idle(id: string): Promise<void> {
    await this.jobs.get(id);
  }

  // ---------------------------------------------------------------- create / split

  /** Answers at once (the route says 202); the split runs detached, written down first so that it can resume. */
  create(instanceId: string, board: string, input: { goal: string; body?: string }): MissionRow {
    const goal = input.goal.trim();
    if (!goal) throw new ValidationError('But manquant');
    if (goal.length > LIMITS.title) throw new ValidationError(`But trop long (${LIMITS.title} caractères au plus)`);
    if (input.body !== undefined && input.body.length > LIMITS.body) throw new ValidationError(`Consigne trop longue (${LIMITS.body} caractères au plus)`);
    this.kanban.requireOps(instanceId, MISSION_OPS);
    const now = this.now();
    const row: MissionRow = {
      id: `m_${randomBytes(6).toString('hex')}`, instanceId, board, rootId: null, goal, state: 'decomposing',
      error: null, decomposeStartedAt: null, createdAt: now, updatedAt: now,
    };
    this.db.insert(kanbanMissions).values(row).run();
    this.detach(row.id, () => this.split(row, input.body));
    return row;
  }

  private async split(m: MissionRow, body: string | undefined): Promise<void> {
    let root: string;
    try {
      root = (await this.kanban.createTask(m.instanceId, m.board, { title: m.goal, body, start: 'triage' })).id;
    } catch (err) {
      this.set(m.id, { state: 'failed', error: `Tâche racine refusée : ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const started = this.now();
    this.set(m.id, { rootId: root, decomposeStartedAt: started });
    const row = { ...m, rootId: root, decomposeStartedAt: started };
    let res: Record<string, unknown>;
    try {
      res = await this.kanban.aux(m.instanceId, m.board, root, 'decompose', { timeoutMs: DECOMPOSE_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof KanbanError && err.code === 'aux_failed') {
        this.set(m.id, { state: 'failed', error: err.message });
        return;
      }
      if (err instanceof HermesError && (err.kind === 'network' || err.kind === 'timeout')) {
        // the answer was lost (time-out, network): Hermes may still finish the split
        await this.settle(row);
        return;
      }
      this.set(m.id, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (res.fanout === false) {
      this.set(m.id, { state: 'failed', error: 'Hermes n’a pas découpé ce but en plusieurs tâches' });
      return;
    }
    await this.hold(row);
  }

  /** Children of the root (its parents at Hermes) with their own detail. */
  private async children(m: MissionRow): Promise<{ root: TaskDetail; kids: TaskDetail[] }> {
    const root = await this.kanban.task(m.instanceId, m.board, m.rootId!);
    const kids = await Promise.all(root.parents.map((p) => this.kanban.task(m.instanceId, m.board, p.id)));
    return { root, kids };
  }

  /**
   * Parks every child Hermes may launch; a child already running is left alone (« déjà lancée »). A refused PATCH is
   * re-read: still `todo`/`ready` (network error, 5xx) → tried again; after HOLD_TRIES the mission fails and what
   * could start is archived (root first), so that nothing runs without the review.
   */
  private async hold(m: MissionRow): Promise<void> {
    const { kids } = await this.children(m);
    const stuck: string[] = [];
    for (const k of kids) {
      let status = k.task.status;
      let last: unknown = null;
      for (let i = 0; i < HOLD_TRIES && HELD_STATES.has(status); i++) {
        try {
          await this.kanban.updateTask(m.instanceId, m.board, k.task.id, { status: 'scheduled', blockReason: HOLD_REASON });
          status = 'scheduled';
        } catch (err) {
          last = err;
          if (i < HOLD_TRIES - 1) await this.sleep(HOLD_RETRY_MS);
          // the dispatcher may have taken it in between: then it shows as « déjà lancée »
          status = await this.kanban.task(m.instanceId, m.board, k.task.id).then((d) => d.task.status, () => status);
        }
      }
      if (HELD_STATES.has(status)) {
        stuck.push(k.task.title);
        this.log(`${m.id}: ${k.task.id} not held (${last instanceof Error ? last.message : String(last)})`);
      }
    }
    if (stuck.length) {
      await this.archive(m, m.rootId!).catch(() => {});
      for (const k of kids) {
        const now = await this.kanban.task(m.instanceId, m.board, k.task.id).then((d) => d.task.status, () => 'unknown');
        if (HELD_STATES.has(now) || now === 'scheduled') await this.archive(m, k.task.id).catch(() => {});
      }
      this.set(m.id, { state: 'failed', error: `Hermes n’a pas retenu « ${stuck[0]} » : mission arrêtée et ses tâches archivées` });
      return;
    }
    if (this.stateOf(m.id) === 'decomposing') this.set(m.id, { state: kids.length ? 'held' : 'failed', error: kids.length ? null : 'Hermes n’a créé aucune tâche' });
  }

  /** Answer lost: re-reads the root every 10 s until 210 s after the split started. */
  private async settle(m: MissionRow): Promise<void> {
    if (!m.rootId) {
      this.set(m.id, { state: 'failed', error: 'Découpage interrompu avant la création de la tâche racine, à relancer' });
      return;
    }
    const until = (m.decomposeStartedAt ?? m.createdAt) + SETTLE_MS;
    for (;;) {
      if (this.stateOf(m.id) !== 'decomposing') return;
      try {
        const root = await this.kanban.task(m.instanceId, m.board, m.rootId);
        if (root.parents.length) {
          await this.hold(m);
          return;
        }
      } catch (err) {
        if (err instanceof NotFoundError) {
          this.set(m.id, { state: 'failed', error: 'Tâche racine disparue chez Hermes' });
          return;
        }
        // Hermes unreachable: keep trying until the deadline
      }
      if (this.now() >= until) break;
      await this.sleep(Math.min(SETTLE_EVERY_MS, Math.max(0, until - this.now())));
    }
    this.set(m.id, { state: 'failed', error: 'Découpage interrompu, à relancer' });
  }

  /** Startup: every split cut by a stop of Intendia is settled (past 210 s, at once). */
  resume(): void {
    const rows = this.db.select().from(kanbanMissions).where(eq(kanbanMissions.state, 'decomposing')).all() as MissionRow[];
    for (const r of rows) this.detach(r.id, () => this.settle(r));
  }

  // ---------------------------------------------------------------- read

  list(instanceId: string, board: string): MissionRow[] {
    this.kanban.assertInstance(instanceId);
    return this.db.select().from(kanbanMissions)
      .where(and(eq(kanbanMissions.instanceId, instanceId), eq(kanbanMissions.board, board), ne(kanbanMissions.state, 'cancelled')))
      .orderBy(asc(kanbanMissions.createdAt)).all() as MissionRow[];
  }

  async get(instanceId: string, id: string): Promise<Mission> {
    const m = this.row(instanceId, id);
    if (!m.rootId || m.state === 'decomposing' || m.state === 'cancelled') return { ...m, rootStatus: null, children: [] };
    const { root, kids } = await this.children(m);
    const ids = new Set(kids.map((k) => k.task.id));
    const held = (k: TaskDetail) => k.task.status === 'scheduled' && k.blockReason === HOLD_REASON;
    const busy = kids.some(held) ? new Set((await this.kanban.workers(instanceId)).filter((w) => w.board === m.board).map((w) => w.taskId)) : new Set<string>();
    return {
      ...m,
      rootStatus: root.task.status,
      children: kids.map((k) => ({
        id: k.task.id, title: k.task.title, body: k.task.body, status: k.task.status, assignee: k.task.assignee,
        after: k.parents.map((p) => p.id).filter((p) => ids.has(p)),
        held: held(k),
        lostTracking: held(k) && busy.has(k.task.id),
      })),
    };
  }

  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.acting.has(id)) throw new KanbanError('mission_state', 'Une autre action est en cours sur cette mission');
    this.acting.add(id);
    try {
      return await work();
    } finally {
      this.acting.delete(id);
    }
  }

  private async heldMission(instanceId: string, id: string): Promise<Mission> {
    const m = await this.get(instanceId, id);
    if (m.state !== 'held') throw new KanbanError('mission_state', 'Cette mission n’est plus en relecture');
    return m;
  }

  // ---------------------------------------------------------------- actions

  /** Drops a held child (archived at Hermes), before the launch only. */
  async remove(instanceId: string, id: string, childId: string): Promise<Mission> {
    return this.exclusive(id, async () => {
      const m = await this.heldMission(instanceId, id);
      const child = m.children.find((c) => c.id === childId && c.held);
      if (!child) throw new NotFoundError('Tâche retenue introuvable dans cette mission');
      const waiting = m.children.filter((c) => c.held && c.after.includes(childId));
      if (waiting.length) {
        throw new KanbanError('mission_dependency', `« ${waiting[0]!.title} » attend cette tâche : retirez-la d’abord`);
      }
      if (m.children.filter((c) => c.held).length === 1) {
        throw new KanbanError('mission_last', 'C’est la dernière tâche retenue : annulez plutôt la mission');
      }
      await this.kanban.updateTask(instanceId, m.board, childId, { status: 'archived' });
      return this.get(instanceId, id);
    });
  }

  /** Held children to `ready` (Hermes puts back in `todo` those whose parents are not done), then one dispatch. */
  async launch(instanceId: string, id: string): Promise<Mission> {
    return this.exclusive(id, async () => {
      const m = await this.heldMission(instanceId, id);
      for (const c of m.children.filter((x) => x.held)) await this.kanban.updateTask(instanceId, m.board, c.id, { status: 'ready' });
      this.set(id, { state: 'launched' });
      try {
        await this.kanban.dispatch(instanceId, m.board, false);
      } catch (err) {
        // the dispatcher passes by itself every 60 s
        this.log(`${id}: dispatch failed (${err instanceof Error ? err.message : String(err)})`);
      }
      return this.get(instanceId, id);
    });
  }

  /** Root archived first (else it would turn ready between two calls), then the held children. */
  async cancel(instanceId: string, id: string): Promise<MissionRow> {
    return this.exclusive(id, async () => {
      const m = this.row(instanceId, id);
      if (m.state !== 'held' && m.state !== 'failed') throw new KanbanError('mission_state', 'Seule une mission en relecture ou en échec s’annule ici');
      if (m.rootId) {
        const held = m.state === 'held' ? (await this.get(instanceId, id)).children.filter((c) => c.held) : [];
        await this.archive(m, m.rootId);
        for (const c of held) await this.archive(m, c.id);
      }
      this.set(id, { state: 'cancelled' });
      return this.row(instanceId, id);
    });
  }

  private async archive(m: MissionRow, taskId: string): Promise<void> {
    try {
      await this.kanban.updateTask(m.instanceId, m.board, taskId, { status: 'archived' });
    } catch (err) {
      if (err instanceof NotFoundError) return;
      // already archived (a failed hold archived it): nothing left to do
      const now = await this.kanban.task(m.instanceId, m.board, taskId).then((d) => d.task.status, () => null);
      if (now !== 'archived') throw err;
    }
  }
}
