// The goal loop (option 7): every 3 s, one pass at a time, over the active goals. For each one, when the session's
// last run is over and not decided yet: done (end marker), pause (failure, stop, blocked, cap, budget, click mode) or
// relaunch. Runs on the server, so it goes on with every tab closed and picks up after a restart (state in the
// database). A relaunch is counted after it started: the new lastRunId means a run is never decided twice.
import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { NotFoundError, type SessionContext } from '../workspaces/service.js';
import { readRunStatus } from './history.js';
import { readMarker, relaunchInput, type Goal, type PauseReason } from './goal.js';
import { GoalInactiveError, RunBusyError, settle, startRun, type StartRunDeps } from './start-run.js';

const EVERY_MS = 3_000;
/** start errors in a row (other than "a run goes on") before the goal pauses with `start_failed` */
const START_TRIES = 3;

export type GoalDecision =
  | { kind: 'done' }
  | { kind: 'pause'; reason: PauseReason; detail?: string }
  | { kind: 'relaunch' }
  | { kind: 'wait' };

export class GoalRunner {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly failures = new Map<string, number>();

  constructor(private readonly deps: StartRunDeps, private readonly log: (line: string) => void = (l) => console.error(l)) {}

  /** One pass; returns what was decided per goal (`<instance>/<session>` → decision), for the tests. */
  async pass(): Promise<Map<string, GoalDecision>> {
    const out = new Map<string, GoalDecision>();
    if (this.busy) return out;
    this.busy = true;
    try {
      for (const g of this.deps.goals.listActive()) {
        const key = `${g.instanceId}/${g.sessionId}`;
        try {
          out.set(key, await this.step(g));
        } catch (err) {
          // Hermes unreachable, database busy: the next pass sees what is left
          this.log(`[intendia] objectif ${key} : ${(err as Error).message}`);
        }
      }
    } finally {
      this.busy = false;
    }
    return out;
  }

  private async step(g: Goal): Promise<GoalDecision> {
    const { goals, workspaces, compat } = this.deps;
    const key = `${g.instanceId}/${g.sessionId}`;
    let ctx: SessionContext;
    try {
      ctx = workspaces.getSession(g.instanceId, g.sessionId);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      // deleted (or pending undo): the row stays, paused; undoing the deletion finds it again
      goals.pauseIfActive(g.instanceId, g.sessionId, 'gone');
      return { kind: 'pause', reason: 'gone' };
    }
    const runId = ctx.session.lastRunId;
    if (!runId || runId === g.handledRunId) return { kind: 'wait' };
    const s = await readRunStatus(compat, g.instanceId, ctx.profile, runId);
    const pause = (reason: PauseReason, detail?: string): GoalDecision => {
      goals.pauseIfActive(g.instanceId, g.sessionId, reason, { detail: detail ?? null, handledRunId: runId });
      this.log(`[intendia] objectif ${key} : pause ${reason}${detail ? ` (${detail.slice(0, 120)})` : ''}`);
      return { kind: 'pause', reason, ...(detail ? { detail } : {}) };
    };
    if (s.status === 'unknown') return pause('lost');
    // running, waiting for an approval or an answer: the loop waits
    if (!TERMINAL_STATUSES.includes(s.status)) return { kind: 'wait' };
    if (s.status === 'failed') return pause('failed', s.error ?? undefined);
    if (s.status !== 'completed') return pause('stopped');
    const marker = readMarker(s.output);
    if (marker?.kind === 'done') {
      goals.finishIfActive(g.instanceId, g.sessionId, runId);
      this.log(`[intendia] objectif ${key} : atteint`);
      return { kind: 'done' };
    }
    if (marker?.kind === 'blocked') return pause('blocked', marker.detail || undefined);
    if (g.relaunches >= g.maxRelaunches) return pause('limit');
    if (g.budgetUsd !== null) {
      // the last run's cost, when Hermes already wrote it (one reading); else it counts at the next decision
      await settle(this.deps, ctx);
      const spent = goals.spent(g);
      if (spent.usd >= g.budgetUsd) return pause('budget');
      if (spent.unpriced > 0) return pause('cost_unknown');
    }
    if (g.mode === 'click') return pause('click');
    const n = g.relaunches + 1;
    try {
      await startRun(this.deps, ctx, relaunchInput(n, g.maxRelaunches), { forGoal: true });
    } catch (err) {
      // another send got there first: that run is decided at its end; paused or removed meanwhile: nothing to do
      if (err instanceof RunBusyError || err instanceof GoalInactiveError) return { kind: 'wait' };
      const tries = (this.failures.get(key) ?? 0) + 1;
      this.failures.set(key, tries);
      if (tries >= START_TRIES) {
        this.failures.delete(key);
        return pause('start_failed', (err as Error).message);
      }
      throw err;
    }
    this.failures.delete(key);
    goals.countRelaunch(g.instanceId, g.sessionId);
    this.log(`[intendia] objectif ${key} : relance ${n}/${g.maxRelaunches}`);
    return { kind: 'relaunch' };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pass().catch((err) => this.log(`[intendia] objectif : ${(err as Error).message}`)), EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
