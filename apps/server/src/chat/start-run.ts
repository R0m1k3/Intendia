// Starting a run of an Intendia session, shared by the send route, the goal routes and the goal loop (chat/goal.ts):
// one lock, one cost handover, one way to build the instructions. Also the run_stats settling read by the chat routes.
import { createHash, randomUUID } from 'node:crypto';
import { msg } from '../i18n/index.js';
import type { CompatService } from '../compat/service.js';
import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import { RunExtrasError, skillBlocks } from '../sessions/run-extras.js';
import type { SkillService } from '../skills/service.js';
import { pushTitle } from '../workspaces/title.js';
import type { PublicSession, RunStatRow, SessionContext, WorkspaceService } from '../workspaces/service.js';
import { readHistory, readRunStatus, runKey, startingRuns } from './history.js';
import { goalBlock, type GoalStore } from './goal.js';
import { COST_SETTLE_MS, finishFields, runCost, sessionCost, type CostReading } from './run-stats.js';
import { log } from '../log.js';

export interface StartRunDeps {
  compat: CompatService;
  workspaces: WorkspaceService;
  skills: SkillService;
  goals: GoalStore;
  /** Timeout of one `POST /v1/runs` (tests: shorter); default CREATE_RUN_TIMEOUT_MS. */
  createRunTimeoutMs?: number;
}

/** Timeout of one `POST /v1/runs`: Hermes may take long to admit a run (loading the agent, a busy model). */
export const CREATE_RUN_TIMEOUT_MS = 60_000;
/** Whole `startRun` call, second attempt included (a proxy in front of Intendia must wait longer: docs/install.md). */
export const START_RUN_BUDGET_MS = 80_000;
/** No second attempt with less than this left in the budget. */
export const RETRY_MIN_MS = 10_000;
const SENT_BODIES_MAX = 500;
const SENT_BODY_TTL_MS = 24 * 3600_000;

/** Key given by a client (the page: once per composed message). */
export const CLIENT_KEY_RE = /^[A-Za-z0-9-]{8,64}$/;

/** `Idempotency-Key` of a run: the session id (SESSION_ID_RE) then the intent; at most 255 visible ASCII characters. */
export function idemKey(sessionId: string, suffix: string): string {
  return `${sessionId}:${suffix}`;
}

/** Short stable hash of an intent (goal relaunch, delivery of sub-agents). */
export const hashKey = (parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);

/**
 * Timeout of the next `create()`: the configured one, cut to what is left of the budget; null when a retry would
 * have less than RETRY_MIN_MS.
 */
export function createTimeout(deadline: number, now: number, configured: number, retry: boolean): number | null {
  const left = deadline - now;
  if (retry && left < RETRY_MIN_MS) return null;
  return Math.max(1, Math.min(configured, left));
}

/** Same key, other text or other skills (checked against the bodies kept by this process): nothing sent. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super(msg('Ce message a déjà été envoyé avec un autre contenu : renvoyez-le pour un nouvel envoi'));
    this.name = 'IdempotencyConflictError';
  }
}

/** Hermes answered 409 `idempotency_key_conflict`: it already admitted a run for this key (with another body). */
export class AlreadySentError extends Error {
  constructor() {
    super(msg('Ce message a déjà été reçu par Hermes : sa réponse apparaîtra dans la conversation'));
    this.name = 'AlreadySentError';
  }
}

/**
 * Bodies sent per key, so a new send of the same key has the same fingerprint at Hermes (which hashes the whole
 * body: instructions included, and they may have changed meanwhile). In memory: lost on restart.
 */
/** The key of each start in progress, by session lock (a busy resend of that key is told it is its own). */
const startingKeys = new Map<string, string>();

/** Kept bodies by key; `runId` once Hermes admitted the run of this key (a resend busy on it is told so). */
const sentBodies = new Map<string, { body: Record<string, unknown>; input: string; skills: string; at: number; runId?: string }>();

function keepBody(key: string, entry: { body: Record<string, unknown>; input: string; skills: string }) {
  const now = Date.now();
  for (const [k, v] of sentBodies) if (now - v.at > SENT_BODY_TTL_MS) sentBodies.delete(k);
  sentBodies.delete(key);
  sentBodies.set(key, { ...entry, at: now });
  while (sentBodies.size > SENT_BODIES_MAX) sentBodies.delete(sentBodies.keys().next().value!);
}

/** Tests only: forgets the kept bodies (a restart of Intendia). */
export function resetSentBodies(): void {
  startingKeys.clear();
  sentBodies.clear();
}

export const RUN_BUSY = msg('Un run est déjà en cours dans cette session');

/**
 * What a busy send knows of its own key: the run Hermes admitted for it (`runId`), or its first call still waiting
 * on Hermes (`runId: null`, `lastRunId` = the session's last run before it). Absent: another intent keeps the
 * session busy.
 */
export type BusyMine = { runId: string | null; lastRunId: string | null };

/** A run of the session goes on (or is being started): the send is refused (409). */
export class RunBusyError extends Error {
  constructor(readonly mine?: BusyMine) {
    super(RUN_BUSY);
    this.name = 'RunBusyError';
  }
}

/** An automatic start (relaunch) whose goal is no longer active: nothing was started. */
export class GoalInactiveError extends Error {
  constructor() {
    super(msg('Objectif plus actif'));
    this.name = 'GoalInactiveError';
  }
}

type Status = Awaited<ReturnType<typeof readRunStatus>>;

const status = (deps: StartRunDeps, ctx: SessionContext, runId: string) => readRunStatus(deps.compat, ctx.instance.id, ctx.profile, runId);

/** Cumulated cost of the live session; null when it cannot be read (the run's cost is then unknown). */
export async function liveCost(deps: StartRunDeps, ctx: SessionContext, known?: { liveId: string; exists: boolean }): Promise<CostReading | null> {
  try {
    const h = known ?? await readHistory(deps.compat, ctx.instance.id, ctx.session.id, ctx.profile, 1);
    if (!h.exists) return { sessionId: h.liveId, cost: 0 };
    const s = await callOp<{ actual_cost_usd?: number | null; estimated_cost_usd?: number | null }>(
      deps.compat.http(ctx.instance.id), deps.compat.get(ctx.instance.id), 'sessions', 'get', { params: { session_id: h.liveId }, profile: ctx.profile },
    );
    return { sessionId: h.liveId, cost: sessionCost(s) };
  } catch {
    return null;
  }
}

/**
 * Cumulated cost of the session a row ran in, read with `sessions.get` only (never the messages). The session a
 * run is admitted in does not follow a compression: ended by a compression = the cost moved on, unknown.
 */
export async function liveCostFromRow(deps: StartRunDeps, ctx: SessionContext, row: RunStatRow): Promise<CostReading | null> {
  // a running row has no Hermes session id yet: the live session it started on (its baseline)
  const sessionId = row.hermesSessionId ?? row.costBeforeSessionId ?? ctx.session.id;
  try {
    const s = await callOp<{ actual_cost_usd?: number | null; estimated_cost_usd?: number | null; ended_at?: number | null; end_reason?: string | null }>(
      deps.compat.http(ctx.instance.id), deps.compat.get(ctx.instance.id), 'sessions', 'get', { params: { session_id: sessionId }, profile: ctx.profile },
    );
    if (s.ended_at != null && s.end_reason === 'compression') return null;
    return { sessionId, cost: sessionCost(s) };
  } catch (err) {
    if (err instanceof HermesError && err.detail.status === 404) return { sessionId, cost: 0 };
    return null;
  }
}

/**
 * Records the end of the session's running rows (read once, written once), then re-costs its last finished
 * row while it is not final. Returns the status of the session's last run when it was read.
 */
export async function settle(
  deps: StartRunDeps, ctx: SessionContext,
  /** liveFromRows: without `known`, the cost is read from the row's session (`sessions.get`), never the messages */
  opts: { known?: { liveId: string; exists: boolean }; cost?: CostReading | null; liveFromRows?: boolean } = {},
): Promise<Status | null> {
  const { workspaces } = deps;
  let last: Status | null = null;
  const inst = ctx.instance.id;
  for (const row of workspaces.runStats(inst, ctx.session.id, { running: true }).filter((r) => r.status === 'running')) {
    const s = await status(deps, ctx, row.runId);
    if (row.runId === ctx.session.lastRunId) last = s;
    const now = Date.now();
    if (s.raw === null) {
      workspaces.finishRunStat(inst, row.runId, { status: 'unknown', endedAt: now, hermesSessionId: null });
    } else if (TERMINAL_STATUSES.includes(s.status)) {
      const first = workspaces.finishRunStat(inst, row.runId, { ...finishFields(s.raw, now), hermesSessionId: s.raw.session_id ?? ctx.session.id });
      // the session exists at Hermes after its first run: give it the same title (Telegram, CLI), once, unawaited
      if (first && workspaces.runStats(inst, ctx.session.id, { running: true }).length === 1) {
        const fresh = workspaces.getSession(inst, ctx.session.id);
        void pushTitle({ compat: deps.compat }, fresh, fresh.session.title, 5_000);
      }
    }
  }
  const done = workspaces.runStats(inst, ctx.session.id);
  const tail: RunStatRow | undefined = done[done.length - 1];
  if (tail && !tail.costFinal && tail.status !== 'unknown') {
    const reading = opts.cost !== undefined ? opts.cost
      : opts.liveFromRows && !opts.known ? await liveCostFromRow(deps, ctx, tail) : await liveCost(deps, ctx, opts.known);
    const final = tail.endedAt !== null && Date.now() - tail.endedAt > COST_SETTLE_MS;
    workspaces.setRunCost(inst, tail.runId, runCost(tail.costBeforeUsd, tail.costBeforeSessionId, reading), final);
  }
  return last;
}

/**
 * At send time, closes the cost of the session's last finished row and gives the new row its baseline. A row
 * Hermes has visibly not costed yet (ended less than COST_SETTLE_MS ago, tokens measured, nothing counted) is
 * not frozen at 0: its cost becomes unknown and the new row starts from its baseline, so the new row's cost
 * covers both. A row already costed is frozen (at worst its last call, still queued, lands on the next run).
 */
export function handOverCost(deps: StartRunDeps, ctx: SessionContext, cost: CostReading | null) {
  const { workspaces } = deps;
  const done = workspaces.runStats(ctx.instance.id, ctx.session.id);
  const tail: RunStatRow | undefined = done[done.length - 1];
  const fresh = { costBeforeUsd: cost?.cost ?? null, costBeforeSessionId: cost?.sessionId ?? null, costRuns: 1 };
  if (!tail || tail.costFinal) return fresh;
  if (tail.status === 'unknown') {
    workspaces.setRunCost(ctx.instance.id, tail.runId, null, true);
    return fresh;
  }
  const own = runCost(tail.costBeforeUsd, tail.costBeforeSessionId, cost);
  const pending = own === 0 && tail.inputTokens !== null && tail.endedAt !== null && Date.now() - tail.endedAt <= COST_SETTLE_MS;
  if (pending) {
    workspaces.setRunCost(ctx.instance.id, tail.runId, null, true);
    return { costBeforeUsd: tail.costBeforeUsd, costBeforeSessionId: tail.costBeforeSessionId, costRuns: tail.costRuns + 1 };
  }
  workspaces.setRunCost(ctx.instance.id, tail.runId, own, true);
  return fresh;
}

/**
 * Starts a run of the session: one creation at a time per session (two tabs, or a tab and the goal loop, could
 * otherwise both pass the "no run in progress" check and start two runs, the second overwriting the first in
 * lastRunId). Throws RunBusyError while a run goes on, RunExtrasError for an unknown skill.
 *
 * Every run carries an `Idempotency-Key` (session id + `keySuffix`, the intent: a message composed by the page, a
 * goal relaunch, a delivery of sub-agents; random without one). When Hermes announces durable idempotency, a
 * timeout or a network error is retried once with the same key: Hermes replays the run instead of starting a
 * second one. Throws IdempotencyConflictError (same key, other text or skills) and AlreadySentError (Hermes
 * already admitted a run for this key with another body).
 */
export async function startRun(
  deps: StartRunDeps, ctx: SessionContext, input: string,
  /** forGoal: an automatic relaunch, started only while the goal is still active (re-read under the run lock) */
  opts: { skills?: string[]; forGoal?: boolean; keySuffix?: string } = {},
): Promise<{ runId: string; session: PublicSession }> {
  const { workspaces } = deps;
  const deadline = Date.now() + START_RUN_BUDGET_MS;
  const lock = runKey(ctx.instance.id, ctx.session.id);
  const key = idemKey(ctx.session.id, opts.keySuffix ?? randomUUID());
  // a resend of this very intent (a 502 of the proxy while the first call still waits): say whose run it is
  const mine = (inFlight: boolean): BusyMine | undefined => {
    const kept = sentBodies.get(key);
    if (!kept) return undefined;
    if (kept.runId) return { runId: kept.runId, lastRunId: null };
    return inFlight && startingKeys.get(lock) === key ? { runId: null, lastRunId: ctx.session.lastRunId } : undefined;
  };
  if (startingRuns.has(lock)) throw new RunBusyError(mine(true));
  startingRuns.add(lock);
  startingKeys.set(lock, key);
  try {
    // re-read: the session may have changed meanwhile
    const fresh = workspaces.getSession(ctx.instance.id, ctx.session.id);
    const lastRunId = fresh.session.lastRunId;
    // one cost reading: cost of the previous run and "cost before" of this one
    const cost = await liveCost(deps, fresh);
    let last = await settle(deps, fresh, { cost });
    // a last run without a row (started before run_stats existed) is checked directly
    if (lastRunId && !last && !workspaces.runStats(fresh.instance.id, fresh.session.id).some((r) => r.runId === lastRunId)) {
      last = await status(deps, fresh, lastRunId);
    }
    if (last && last.status !== 'unknown' && !TERMINAL_STATUSES.includes(last.status)) throw new RunBusyError(mine(false));
    // paused or removed while the caller waited on Hermes: no relaunch
    if (opts.forGoal && deps.goals.get(fresh.instance.id, fresh.session.id)?.status !== 'active') throw new GoalInactiveError();
    const { model, modelProvider, effort } = fresh.session;
    // skills first: an unknown one stops the send before the run (400)
    const skills = [...new Set(opts.skills ?? [])];
    const extra = skills.length ? await skillBlocks(deps.skills, fresh, skills) : [];
    const goal = deps.goals.get(fresh.instance.id, fresh.session.id);
    const instructions = [
      await workspaces.instructionsFor(fresh), ...extra,
      ...(goal?.status === 'active' ? [goalBlock(goal.text)] : []),
    ].join('\n\n');
    const skillsKey = [...skills].sort().join('\n');
    const kept = sentBodies.get(key);
    if (kept && (kept.input !== input || kept.skills !== skillsKey)) throw new IdempotencyConflictError();
    // the same key resends the same body (Hermes fingerprints all of it), even if the instructions changed since
    const body: Record<string, unknown> = kept?.body ?? {
      input, session_id: ctx.session.id, instructions,
      // provider only with a model picked in a group (docs/hermes-api-notes.md)
      ...(model ? { model, ...(modelProvider ? { provider: modelProvider } : {}) } : {}),
      ...(effort ? { model_options: { reasoning_effort: effort } } : {}),
    };
    // first send of this intent in this process: a replay answering the in-call retry is the run of the first
    // attempt, admitted after the cost reading above, so its baseline is known
    const firstSend = !kept;
    keepBody(key, { body, input, skills: skillsKey });

    const configured = deps.createRunTimeoutMs ?? CREATE_RUN_TIMEOUT_MS;
    const create = (timeoutMs: number) => callOp<{ run_id: string; status?: string; replayed?: boolean }>(
      deps.compat.http(ctx.instance.id), deps.compat.get(ctx.instance.id), 'chat', 'createRun',
      { profile: ctx.profile, body, headers: { 'Idempotency-Key': key }, timeoutMs },
    );
    const conflict = (err: unknown) => err instanceof HermesError && err.kind === 'http' && err.detail.status === 409
      && Boolean(err.detail.body?.includes('idempotency_key_conflict'));
    let created: { run_id: string; replayed?: boolean };
    let retried = false;
    try {
      try {
        created = await create(createTimeout(deadline, Date.now(), configured, false)!);
      } catch (err) {
        const runs = deps.compat.get(ctx.instance.id)?.runs;
        const retryable = err instanceof HermesError && (err.kind === 'timeout' || err.kind === 'network') && runs?.idempotency && runs.durable;
        const timeoutMs = retryable ? createTimeout(deadline, Date.now(), configured, true) : null;
        if (timeoutMs === null) throw err;
        log.warn(`[intendia] createRun ${ctx.instance.id}/${ctx.session.id} : nouvel essai, même clé`);
        created = await create(timeoutMs);
        retried = true;
      }
    } catch (err) {
      if (conflict(err)) throw new AlreadySentError();
      throw err;
    }

    const keptNow = sentBodies.get(key);
    if (keptNow) keptNow.runId = created.run_id;
    const row = { instanceId: ctx.instance.id, runId: created.run_id, sessionId: ctx.session.id, status: 'running', requestedModel: model, requestedEffort: effort };
    if (created.replayed === true && !(retried && firstSend)) {
      // Hermes replayed a run of this key: never a second row, never lastRunId moved back
      if (workspaces.runStats(ctx.instance.id, ctx.session.id, { running: true }).some((r) => r.runId === created.run_id)) {
        return { runId: created.run_id, session: workspaces.getSession(ctx.instance.id, ctx.session.id).session };
      }
      const s = await status(deps, fresh, created.run_id).catch(() => null);
      const createdAtMs = s?.createdAt != null ? s.createdAt * 1000 : null;
      const newer = createdAtMs !== null && workspaces.runStats(ctx.instance.id, ctx.session.id, { running: true }).some((r) => r.startedAt > createdAtMs);
      // the baseline of a replayed run is not known (it may have spent before this reading)
      const session = workspaces.recordStartedRun(
        { ...row, startedAt: createdAtMs ?? Date.now(), costBeforeUsd: null, costBeforeSessionId: null },
        input, { setLast: !newer },
      );
      return { runId: created.run_id, session };
    }
    // after the run was accepted: a refused send leaves the previous row settling
    const session = workspaces.recordStartedRun({ ...row, startedAt: Date.now(), ...handOverCost(deps, fresh, cost) }, input);
    return { runId: created.run_id, session };
  } finally {
    startingRuns.delete(lock);
    startingKeys.delete(lock);
  }
}

export { RunExtrasError };
