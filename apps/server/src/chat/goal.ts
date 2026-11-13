// Persistent goal of an Intendia session (option 7, `/goal`). Hermes' own /goal does not run for API server sessions,
// so Intendia keeps the goal (table session_goals), adds it to the instructions of each run while it is active, and
// its server loop (chat/goal-runner.ts) relaunches the agent after each finished run until the agent ends a reply
// with « OBJECTIF ATTEINT », within a relaunch cap and an optional budget. Every write is one conditional SQL
// statement (pause only an active goal, resume only a paused one…): no lock is needed besides the run lock.
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { runStats, sessionGoals } from '../db/schema.js';

export type GoalStatus = 'active' | 'paused' | 'done';
export type GoalMode = 'auto' | 'click';
export const PAUSE_REASONS = [
  'user', 'button', 'click', 'blocked', 'failed', 'stopped', 'lost', 'limit', 'budget', 'start_failed', 'gone', 'cost_unknown',
] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export interface Goal {
  instanceId: string;
  sessionId: string;
  text: string;
  status: GoalStatus;
  mode: GoalMode;
  maxRelaunches: number;
  relaunches: number;
  budgetUsd: number | null;
  costSince: number;
  handledRunId: string | null;
  reason: PauseReason | null;
  reasonDetail: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GoalSpent {
  /** sum of the known costs of the session's runs since `costSince` */
  usd: number;
  /** a run's cost is still being read (Hermes writes it late) */
  pending: boolean;
  /** tokens were counted but every known cost is 0: the model's price is unknown to Hermes */
  priceUnknown: boolean;
  /** finished runs whose cost stayed unknown (compression, Hermes unreachable): the budget is incomplete */
  unpriced: number;
}

export const RELAUNCH_PREFIX = '[Intendia] Relance automatique';
export const DONE_MARKER = 'OBJECTIF ATTEINT';
export const BLOCKED_MARKER = 'OBJECTIF BLOQUÉ';

/** Added to the instructions of every run while the goal is active. */
export function goalBlock(text: string): string {
  return [
    `[Intendia] Objectif de la session : ${text}`,
    `Quand il est atteint, termine ta réponse par cette ligne seule : ${DONE_MARKER}`,
    `Si tu ne peux plus avancer sans l'utilisateur, termine par cette ligne seule : ${BLOCKED_MARKER} : <raison courte>`,
  ].join('\n');
}

export function relaunchInput(n: number, max: number): string {
  return `${RELAUNCH_PREFIX} ${n}/${max} : continue vers l'objectif. S'il est atteint ou bloqué, termine par la ligne prévue.`;
}

/** A text that would pass for one of Intendia's relaunches (refused from the user). */
export const isRelaunchText = (s: string): boolean => s.trimStart().startsWith(RELAUNCH_PREFIX);

/** Start of the message the server sends when background sub-agents delivered (chat/wake.ts). */
export const WAKE_PREFIX = '[Intendia] Reprise automatique';
export const isWakeText = (s: string): boolean => s.trimStart().startsWith(WAKE_PREFIX);
/** Starts reserved to Intendia's own messages (relaunch of a goal, wake after sub-agents): refused from the user. */
export const isReservedText = (s: string): boolean => isRelaunchText(s) || isWakeText(s);

/** The end marker on the last non-empty line of a reply (bold, italics, final dot tolerated); null = none. */
export function readMarker(output: string | null | undefined): { kind: 'done' } | { kind: 'blocked'; detail: string } | null {
  const last = (output ?? '').split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
  if (!last) return null;
  const line = last.normalize('NFC').replace(/^[*_\s]+|[*_\s.]+$/g, '');
  if (/^objectif\s+atteint$/iu.test(line)) return { kind: 'done' };
  const m = /^objectif\s+bloqu[eé](?:\s*:\s*|\s+|$)([\s\S]*)$/iu.exec(line);
  return m ? { kind: 'blocked', detail: m[1]!.replace(/[*_]+$/, '').trim().slice(0, 200) } : null;
}

type Row = typeof sessionGoals.$inferSelect;
const toGoal = (r: Row): Goal => ({ ...r, status: r.status as GoalStatus, mode: r.mode as GoalMode, reason: r.reason as PauseReason | null });

export class GoalStore {
  constructor(private readonly db: Db) {}

  private key(instanceId: string, sessionId: string) {
    return and(eq(sessionGoals.instanceId, instanceId), eq(sessionGoals.sessionId, sessionId));
  }

  get(instanceId: string, sessionId: string): Goal | null {
    const r = this.db.select().from(sessionGoals).where(this.key(instanceId, sessionId)).get();
    return r ? toGoal(r) : null;
  }

  listActive(): Goal[] {
    return this.db.select().from(sessionGoals).where(eq(sessionGoals.status, 'active')).all().map(toGoal);
  }

  /** A new goal (replaces a paused or finished one): active, counter at 0, cost counted from now. */
  create(g: Pick<Goal, 'instanceId' | 'sessionId' | 'text' | 'mode' | 'maxRelaunches' | 'budgetUsd' | 'handledRunId'>, now = Date.now()): Goal {
    const row = {
      ...g, status: 'active', relaunches: 0, costSince: now, reason: null, reasonDetail: null, createdAt: now, updatedAt: now,
    };
    this.db.insert(sessionGoals).values(row).onConflictDoUpdate({
      target: [sessionGoals.instanceId, sessionGoals.sessionId],
      set: { text: row.text, mode: row.mode, maxRelaunches: row.maxRelaunches, budgetUsd: row.budgetUsd, handledRunId: row.handledRunId,
        status: 'active', relaunches: 0, costSince: now, reason: null, reasonDetail: null, createdAt: now, updatedAt: now },
    }).run();
    return this.get(g.instanceId, g.sessionId)!;
  }

  /** Settings of the goal (text, cap, budget, mode); never its state or counter. */
  edit(instanceId: string, sessionId: string, set: Partial<Pick<Goal, 'text' | 'mode' | 'maxRelaunches' | 'budgetUsd'>>, now = Date.now()): Goal | null {
    this.db.update(sessionGoals).set({ ...set, updatedAt: now }).where(this.key(instanceId, sessionId)).run();
    return this.get(instanceId, sessionId);
  }

  remove(instanceId: string, sessionId: string): boolean {
    return this.db.delete(sessionGoals).where(this.key(instanceId, sessionId)).run().changes > 0;
  }

  /** Pauses an active goal (a pause never replaces another one); `handledRunId` = the run decided on, if any. */
  pauseIfActive(instanceId: string, sessionId: string, reason: PauseReason, opts: { detail?: string | null; handledRunId?: string; now?: number } = {}): boolean {
    const set: Partial<Row> = { status: 'paused', reason, reasonDetail: opts.detail ?? null, updatedAt: opts.now ?? Date.now() };
    if (opts.handledRunId !== undefined) set.handledRunId = opts.handledRunId;
    return this.db.update(sessionGoals).set(set).where(and(this.key(instanceId, sessionId), eq(sessionGoals.status, 'active'))).run().changes > 0;
  }

  /** The loop's end of the goal, only on an active goal whose run was not decided yet. */
  finishIfActive(instanceId: string, sessionId: string, runId: string, now = Date.now()): boolean {
    return this.db.update(sessionGoals).set({ status: 'done', reason: null, reasonDetail: null, handledRunId: runId, updatedAt: now })
      .where(and(this.key(instanceId, sessionId), eq(sessionGoals.status, 'active'))).run().changes > 0;
  }

  /**
   * Resumes a paused goal. A spent slice (cap reached, budget reached or incomplete) is renewed whatever the reason
   * of the pause: counter at 0, cost counted from now. `handledRunId` (the finished last run, when no run goes on)
   * is written in the same statement.
   */
  resumeIfPaused(instanceId: string, sessionId: string, o: { resetCounter: boolean; resetCost: boolean; handledRunId?: string | null; now?: number }): boolean {
    const now = o.now ?? Date.now();
    const set: Partial<Row> = { status: 'active', reason: null, reasonDetail: null, updatedAt: now };
    if (o.resetCounter) set.relaunches = 0;
    if (o.resetCost) set.costSince = now;
    if (o.handledRunId !== undefined) set.handledRunId = o.handledRunId;
    return this.db.update(sessionGoals).set(set).where(and(this.key(instanceId, sessionId), eq(sessionGoals.status, 'paused'))).run().changes > 0;
  }

  /** One relaunch started (whatever the state meanwhile: a pause written during the start stays). */
  countRelaunch(instanceId: string, sessionId: string, now = Date.now()): void {
    this.db.update(sessionGoals).set({ relaunches: sql`${sessionGoals.relaunches} + 1`, updatedAt: now }).where(this.key(instanceId, sessionId)).run();
  }

  /** Cost of the session's runs since the goal's `costSince` (run_stats only, no call to Hermes). */
  spent(g: Pick<Goal, 'instanceId' | 'sessionId' | 'costSince'>): GoalSpent {
    const rows = this.db.select().from(runStats)
      .where(and(eq(runStats.instanceId, g.instanceId), eq(runStats.sessionId, g.sessionId), sql`${runStats.startedAt} >= ${g.costSince}`))
      .orderBy(runStats.startedAt).all();
    let usd = 0;
    let pending = false;
    let tokens = false;
    let unpriced = 0;
    rows.forEach((r, i) => {
      if (r.costUsd !== null) usd += r.costUsd;
      if (!r.costFinal) pending = true;
      if (r.costFinal && (r.inputTokens ?? 0) > 0) tokens = true;
      // a frozen unknown cost is covered when the next row took it over (handOverCost: costRuns > 1)
      if (r.costFinal && r.costUsd === null && r.status !== 'running' && !((rows[i + 1]?.costRuns ?? 1) > 1)) unpriced += 1;
    });
    return { usd: Math.round(usd * 1e6) / 1e6, pending, priceUnknown: tokens && usd === 0, unpriced };
  }
}

/** For the copy that replaces a session (Modifier, Réessayer) and its undo: the goal follows, paused. */
export function moveGoalStatement(db: Pick<Db, 'update'>, instanceId: string, from: string, to: string, now: number) {
  return db.update(sessionGoals)
    .set({ sessionId: to, status: sql`CASE WHEN ${sessionGoals.status} = 'done' THEN 'done' ELSE 'paused' END`,
      reason: sql`CASE WHEN ${sessionGoals.status} = 'active' THEN 'user' ELSE ${sessionGoals.reason} END`,
      handledRunId: null, costSince: now, updatedAt: now })
    .where(and(eq(sessionGoals.instanceId, instanceId), eq(sessionGoals.sessionId, from)));
}
