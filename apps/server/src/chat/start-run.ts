// Starting a run of an Intendia session, shared by the send route, the goal routes and the goal loop (chat/goal.ts):
// one lock, one cost handover, one way to build the instructions. Also the run_stats settling read by the chat routes.
import { msg } from '../i18n/index.js';
import type { CompatService } from '../compat/service.js';
import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { callOp } from '../connectors/runtime.js';
import type { ConfigService } from '../hermes-config/service.js';
import type { PromptService } from '../prompts/service.js';
import { personalityBlock, RunExtrasError, skillBlocks } from '../sessions/run-extras.js';
import type { SkillService } from '../skills/service.js';
import { pushTitle } from '../workspaces/title.js';
import type { PublicSession, RunStatRow, SessionContext, WorkspaceService } from '../workspaces/service.js';
import { readHistory, readRunStatus, runKey, startingRuns } from './history.js';
import { goalBlock, type GoalStore } from './goal.js';
import { COST_SETTLE_MS, finishFields, runCost, sessionCost, type CostReading } from './run-stats.js';

export interface StartRunDeps {
  compat: CompatService;
  workspaces: WorkspaceService;
  skills: SkillService;
  config: ConfigService;
  prompts: PromptService;
  goals: GoalStore;
}

export const RUN_BUSY = msg('Un run est déjà en cours dans cette session');

/** A run of the session goes on (or is being started): the send is refused (409). */
export class RunBusyError extends Error {
  constructor() {
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
 * Records the end of the session's running rows (read once, written once), then re-costs its last finished
 * row while it is not final. Returns the status of the session's last run when it was read.
 */
export async function settle(
  deps: StartRunDeps, ctx: SessionContext, opts: { known?: { liveId: string; exists: boolean }; cost?: CostReading | null } = {},
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
    const reading = opts.cost !== undefined ? opts.cost : await liveCost(deps, ctx, opts.known);
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
 */
export async function startRun(
  deps: StartRunDeps, ctx: SessionContext, input: string,
  /** forGoal: an automatic relaunch, started only while the goal is still active (re-read under the run lock) */
  opts: { skills?: string[]; forGoal?: boolean } = {},
): Promise<{ runId: string; session: PublicSession; notice?: string }> {
  const { workspaces } = deps;
  const key = runKey(ctx.instance.id, ctx.session.id);
  if (startingRuns.has(key)) throw new RunBusyError();
  startingRuns.add(key);
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
    if (last && last.status !== 'unknown' && !TERMINAL_STATUSES.includes(last.status)) throw new RunBusyError();
    // paused or removed while the caller waited on Hermes: no relaunch
    if (opts.forGoal && deps.goals.get(fresh.instance.id, fresh.session.id)?.status !== 'active') throw new GoalInactiveError();
    const { model, modelProvider, effort } = fresh.session;
    // skills first: an unknown one stops the send before the run (400), the personality never does
    const extra = opts.skills?.length ? await skillBlocks(deps.skills, fresh, [...new Set(opts.skills)]) : [];
    const persona = await personalityBlock(deps.config, deps.prompts, fresh);
    const goal = deps.goals.get(fresh.instance.id, fresh.session.id);
    const instructions = [
      await workspaces.instructionsFor(fresh), ...extra, ...(persona.block ? [persona.block] : []),
      ...(goal?.status === 'active' ? [goalBlock(goal.text)] : []),
    ].join('\n\n');
    const created = await callOp<{ run_id: string }>(deps.compat.http(ctx.instance.id), deps.compat.get(ctx.instance.id), 'chat', 'createRun', {
      profile: ctx.profile,
      body: {
        input, session_id: ctx.session.id, instructions,
        // provider only with a model picked in a group (docs/hermes-api-notes.md)
        ...(model ? { model, ...(modelProvider ? { provider: modelProvider } : {}) } : {}),
        ...(effort ? { model_options: { reasoning_effort: effort } } : {}),
      },
    });
    // after the run was accepted: a refused send leaves the previous row settling
    workspaces.insertRunStat({
      instanceId: ctx.instance.id, runId: created.run_id, sessionId: ctx.session.id, status: 'running',
      requestedModel: model, requestedEffort: effort, startedAt: Date.now(), ...handOverCost(deps, fresh, cost),
    });
    const session = workspaces.recordRun(ctx.instance.id, ctx.session.id, created.run_id, input);
    return { runId: created.run_id, session, ...(persona.notice ? { notice: persona.notice } : {}) };
  } finally {
    startingRuns.delete(key);
  }
}

export { RunExtrasError };
