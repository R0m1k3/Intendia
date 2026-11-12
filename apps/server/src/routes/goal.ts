// Persistent goal of an Intendia session (option 7, chat/goal.ts): set, read, edit, pause, resume, remove.
import { Hono } from 'hono';
import { z } from 'zod';
import { isRunActive } from '../chat/history.js';
import { relaunchInput, type Goal } from '../chat/goal.js';
import { RunBusyError, RunExtrasError, startRun, type StartRunDeps } from '../chat/start-run.js';
import { sessionParams } from './workspaces.js';

const Budget = z.number().min(0.01).max(100).nullable();
const Settings = {
  text: z.string().trim().min(1).max(2000),
  maxRelaunches: z.number().int().min(1).max(50),
  budgetUsd: Budget,
  mode: z.enum(['auto', 'click']),
};
const CreateBody = z.object({
  text: Settings.text, maxRelaunches: Settings.maxRelaunches.default(5), budgetUsd: Budget.default(1), mode: Settings.mode.default('auto'),
});
const EditBody = z.object({
  text: Settings.text.optional(), maxRelaunches: Settings.maxRelaunches.optional(), budgetUsd: Budget.optional(), mode: Settings.mode.optional(),
});
const PauseBody = z.object({ reason: z.enum(['user', 'button']).default('button') });

const BUDGET_REQUIRED = { error: 'Avec « Sans confirmation », un budget est obligatoire', code: 'budget_required' } as const;

export function goalRoutes(deps: StartRunDeps): Hono {
  const { goals, workspaces } = deps;
  const r = new Hono();
  const ctxOf = (c: Parameters<typeof sessionParams>[0]) => {
    const { inst, id } = sessionParams(c);
    return workspaces.getSession(inst, id);
  };
  const view = (g: Goal | null, lastRunId: string | null) => (g ? {
    text: g.text, status: g.status, mode: g.mode, maxRelaunches: g.maxRelaunches, relaunches: g.relaunches, budgetUsd: g.budgetUsd,
    reason: g.reason, reasonDetail: g.reasonDetail, spent: goals.spent(g), lastRunId, updatedAt: g.updatedAt,
  } : null);

  r.get('/sessions/:inst/:id/goal', (c) => {
    const ctx = ctxOf(c);
    return c.json({ goal: view(goals.get(ctx.instance.id, ctx.session.id), ctx.session.lastRunId) });
  });

  // a new goal, and its first turn with the goal's text as the message
  r.post('/sessions/:inst/:id/goal', async (c) => {
    const ctx = ctxOf(c);
    const body = CreateBody.parse(await c.req.json());
    const inst = ctx.instance.id;
    const id = ctx.session.id;
    if (body.budgetUsd === null && ctx.session.autoApprove) return c.json(BUDGET_REQUIRED, 400);
    if (goals.get(inst, id)?.status === 'active') return c.json({ error: 'Cette session a déjà un objectif en cours', code: 'goal_exists' }, 409);
    if (await isRunActive(deps.compat, ctx)) return c.json({ error: 'Attendez la fin du run ou arrêtez-le', code: 'run_active' }, 409);
    // the last run (finished) is not decided on: only the goal's own runs are
    goals.create({ instanceId: inst, sessionId: id, text: body.text, mode: body.mode, maxRelaunches: body.maxRelaunches, budgetUsd: body.budgetUsd, handledRunId: ctx.session.lastRunId });
    try {
      const started = await startRun(deps, ctx, body.text);
      return c.json({ ...started, goal: view(goals.get(inst, id), started.runId) });
    } catch (err) {
      goals.remove(inst, id);
      if (err instanceof RunBusyError) return c.json({ error: 'Attendez la fin du run ou arrêtez-le', code: 'run_active' }, 409);
      if (err instanceof RunExtrasError) return c.json({ error: err.message, code: err.code }, err.status);
      throw err;
    }
  });

  // settings only (text, cap, budget, mode): allowed during a run, never changes the state or the counter
  r.patch('/sessions/:inst/:id/goal', async (c) => {
    const ctx = ctxOf(c);
    const body = EditBody.parse(await c.req.json());
    const g = goals.get(ctx.instance.id, ctx.session.id);
    if (!g) return c.json({ error: 'Aucun objectif sur cette session', code: 'no_goal' }, 404);
    if (body.budgetUsd === null && ctx.session.autoApprove) return c.json(BUDGET_REQUIRED, 400);
    return c.json({ goal: view(goals.edit(ctx.instance.id, ctx.session.id, body), ctx.session.lastRunId) });
  });

  r.post('/sessions/:inst/:id/goal/pause', async (c) => {
    const ctx = ctxOf(c);
    const { reason } = PauseBody.parse(await c.req.json().catch(() => ({})));
    goals.pauseIfActive(ctx.instance.id, ctx.session.id, reason);
    return c.json({ goal: view(goals.get(ctx.instance.id, ctx.session.id), ctx.session.lastRunId) });
  });

  // resume: a spent slice is renewed; with no run going on, a relaunch leaves at once (counted)
  r.post('/sessions/:inst/:id/goal/resume', async (c) => {
    const ctx = ctxOf(c);
    const inst = ctx.instance.id;
    const id = ctx.session.id;
    const g = goals.get(inst, id);
    if (!g) return c.json({ error: 'Aucun objectif sur cette session', code: 'no_goal' }, 404);
    if (g.status !== 'paused') return c.json({ goal: view(g, ctx.session.lastRunId) });
    if (g.budgetUsd === null && ctx.session.autoApprove) return c.json(BUDGET_REQUIRED, 400);
    const spent = goals.spent(g);
    const resetCounter = g.relaunches >= g.maxRelaunches;
    const resetCost = g.budgetUsd !== null && (spent.usd >= g.budgetUsd || spent.unpriced > 0);
    const running = await isRunActive(deps.compat, ctx);
    // a run going on is decided by the loop at its end; else the finished last run is not decided again
    goals.resumeIfPaused(inst, id, { resetCounter, resetCost, ...(running ? {} : { handledRunId: ctx.session.lastRunId }) });
    if (!running) {
      const fresh = goals.get(inst, id)!;
      try {
        await startRun(deps, ctx, relaunchInput(fresh.relaunches + 1, fresh.maxRelaunches));
        goals.countRelaunch(inst, id);
      } catch (err) {
        // a send got there first: the goal stays active and the loop takes that run's end
        if (!(err instanceof RunBusyError)) {
          goals.pauseIfActive(inst, id, 'start_failed', { detail: (err as Error).message });
          throw err;
        }
      }
    }
    const now = workspaces.getSession(inst, id);
    return c.json({ goal: view(goals.get(inst, id), now.session.lastRunId) });
  });

  r.delete('/sessions/:inst/:id/goal', (c) => {
    const ctx = ctxOf(c);
    goals.remove(ctx.instance.id, ctx.session.id);
    return c.json({ goal: null });
  });

  return r;
}
