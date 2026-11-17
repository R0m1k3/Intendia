import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runStats } from '../src/db/schema.js';
import { goalBlock, goalKeySuffix, readMarker, relaunchInput } from '../src/chat/goal.js';
import { GoalRunner } from '../src/chat/goal-runner.js';
import { GoalInactiveError, resetSentBodies, startRun } from '../src/chat/start-run.js';
import { testApp, waitRun } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;

async function setup(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  const base = `/x/sessions/fake/${s.id}`;
  const lines: string[] = [];
  const runner = () => new GoalRunner(t.services.runDeps, (l) => lines.push(l));
  return { t, s, base, lines, runner };
}

const goal = async (t: T, base: string) => (await t.request('GET', `${base}/goal`)).json.goal;
const lastRunId = async (t: T, base: string) => (await t.request('GET', base)).json.session.lastRunId as string;
const finish = async (t: T, base: string) => waitRun(t, base, await lastRunId(t, base));

/** Loop passes until the goal is no longer active (each run waited for), at most `max` passes. */
async function drive(t: T, base: string, runner: GoalRunner, max = 12) {
  for (let i = 0; i < max; i++) {
    await finish(t, base);
    await runner.pass();
    if ((await goal(t, base)).status !== 'active') return goal(t, base);
  }
  return goal(t, base);
}

const users = async (t: T, base: string) =>
  ((await t.request('GET', `${base}/messages`)).json.messages as { role: string; content: string }[]).filter((m) => m.role === 'user').map((m) => m.content);

describe('readMarker', () => {
  it('reads only the last non-empty line, bold and final dot tolerated, with or without accents', () => {
    expect(readMarker('Fait.\n\nOBJECTIF ATTEINT')).toEqual({ kind: 'done' });
    expect(readMarker('Fait.\n**Objectif atteint.**\n\n')).toEqual({ kind: 'done' });
    expect(readMarker('Objectif bloque : x')).toEqual({ kind: 'blocked', detail: 'x' });
    expect(readMarker('_OBJECTIF BLOQUÉ : il manque la clé_')).toEqual({ kind: 'blocked', detail: 'il manque la clé' });
    expect(readMarker('Je dirai OBJECTIF ATTEINT plus tard.\nPas encore.')).toBeNull();
    expect(readMarker('OBJECTIF ATTEINT bientôt')).toBeNull();
    expect(readMarker('')).toBeNull();
    expect(readMarker(null)).toBeNull();
  });

  it('builds the block and the relaunch text', () => {
    expect(goalBlock('Les tests passent')).toContain('[Intendia] Objectif de la session : Les tests passent');
    expect(relaunchInput(2, 5)).toMatch(/^\[Intendia\] Relance automatique 2\/5 :/);
  });
});

describe('goal loop', () => {
  it('relaunches until the agent says the goal is reached, then stops', async () => {
    const { t, base, runner, lines } = await setup();
    const res = await t.request('POST', `${base}/goal`, { text: 'objectif-3 : ranger le dossier' });
    expect(res.status).toBe(200);
    expect(res.json.goal).toMatchObject({ status: 'active', relaunches: 0, maxRelaunches: 5, budgetUsd: 1, mode: 'auto', lastRunId: res.json.runId });
    // the first turn: the goal's text as the message, the block in the instructions
    expect(t.fake.sim.lastRun!.input).toBe('objectif-3 : ranger le dossier');
    expect(t.fake.sim.lastRun!.instructions).toContain('[Intendia] Objectif de la session : objectif-3');
    const g = await drive(t, base, runner());
    expect(g).toMatchObject({ status: 'done', relaunches: 2 });
    expect(await users(t, base)).toEqual([
      'objectif-3 : ranger le dossier', relaunchInput(1, 5), relaunchInput(2, 5),
    ]);
    // nothing more at the next passes
    const count = (await users(t, base)).length;
    await runner().pass();
    expect((await users(t, base)).length).toBe(count);
    expect(lines.some((l) => l.includes('atteint'))).toBe(true);
    expect(g.spent.usd).toBeGreaterThan(0);
  });

  it('pauses at the cap; resuming opens a new slice and relaunches at once', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9', maxRelaunches: 2, budgetUsd: null });
    expect(await drive(t, base, runner())).toMatchObject({ status: 'paused', reason: 'limit', relaunches: 2 });
    // a message of the user afterwards keeps the first reason
    await t.request('POST', `${base}/goal/pause`, { reason: 'user' });
    expect((await goal(t, base)).reason).toBe('limit');
    const r = await t.request('POST', `${base}/goal/resume`);
    expect(r.json.goal).toMatchObject({ status: 'active', relaunches: 1 });
    expect(t.fake.sim.lastRun!.input).toBe(relaunchInput(1, 2));
  });

  it('pauses when the agent is blocked, when the run fails, when stopped', async () => {
    const a = await setup();
    await a.t.request('POST', `${a.base}/goal`, { text: 'objectif-bloque' });
    expect(await drive(a.t, a.base, a.runner())).toMatchObject({ status: 'paused', reason: 'blocked', reasonDetail: 'il manque la clé' });

    const b = await setup();
    await b.t.request('POST', `${b.base}/goal`, { text: 'panne générale' });
    expect(await drive(b.t, b.base, b.runner())).toMatchObject({ status: 'paused', reason: 'failed' });

    const c = await setup();
    await c.t.request('POST', `${c.base}/goal`, { text: 'objectif-9 lent' });
    const run = await lastRunId(c.t, c.base);
    await c.t.request('POST', `${c.base}/runs/${run}/stop`, {});
    expect(await drive(c.t, c.base, c.runner())).toMatchObject({ status: 'paused', reason: 'stopped' });
  });

  it('pauses on the budget (one turn late at most)', async () => {
    const { t, base, runner } = await setup();
    // each fake run adds 0.0123 $
    await t.request('POST', `${base}/goal`, { text: 'objectif-9', budgetUsd: 0.01 });
    const g = await drive(t, base, runner());
    expect(g).toMatchObject({ status: 'paused', reason: 'budget' });
    expect(g.relaunches).toBeLessThanOrEqual(2);
    expect(g.spent.usd).toBeGreaterThanOrEqual(0.01);
    // resume: a new slice from now
    const r = await t.request('POST', `${base}/goal/resume`);
    expect(r.json.goal.status).toBe('active');
  });

  it('a frozen unknown cost with a budget pauses (cost_unknown)', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    const run = await lastRunId(t, base);
    await waitRun(t, base, run);
    t.db.update(runStats).set({ costUsd: null, costFinal: true }).where(and(eq(runStats.instanceId, 'fake'), eq(runStats.runId, run))).run();
    // settle is skipped on a final row: the unknown cost stays
    expect(await drive(t, base, runner(), 1)).toMatchObject({ status: 'paused', reason: 'cost_unknown' });
  });

  it('the user writing (message or reorientation) pauses it; the run leaves without the block', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    await finish(t, base);
    const sent = await t.request('POST', `${base}/runs`, { input: 'Autre chose' });
    expect(sent.status).toBe(200);
    expect(t.fake.sim.lastRun!.instructions).not.toContain('Objectif de la session');
    expect(await goal(t, base)).toMatchObject({ status: 'paused', reason: 'user' });
    await finish(t, base);
    const before = (await users(t, base)).length;
    await runner().pass();
    expect((await users(t, base)).length).toBe(before);

  });

  it('a reorientation pauses it too', async () => {
    const { t, base } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9 lent interminable' });
    const run = await lastRunId(t, base);
    for (let i = 0; i < 100 && t.fake.sim.lastRun!.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    expect((await t.request('POST', `${base}/runs/${run}/steer`, { input: 'plus vite' })).status).toBe(200);
    expect(await goal(t, base)).toMatchObject({ status: 'paused', reason: 'user' });
    await t.request('POST', `${base}/runs/${run}/stop`, {});
  });

  it('click mode pauses after each turn; resume relaunches once', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9', mode: 'click' });
    expect(await drive(t, base, runner())).toMatchObject({ status: 'paused', reason: 'click', relaunches: 0 });
    expect((await t.request('POST', `${base}/goal/resume`)).json.goal).toMatchObject({ status: 'active', relaunches: 1 });
    expect(await drive(t, base, runner())).toMatchObject({ status: 'paused', reason: 'click', relaunches: 1 });
  });

  it('never relaunches twice for a run: concurrent passes, a restart', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    await finish(t, base);
    const r = runner();
    await Promise.all([r.pass(), r.pass(), runner().pass()]);
    expect((await goal(t, base)).relaunches).toBe(1);
    await finish(t, base);
    // a new runner on the same base (restart) decides on the new run only
    await runner().pass();
    expect((await goal(t, base)).relaunches).toBe(2);
  });

  it('waits while the run waits for an approval', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'approval objectif-1' });
    for (let i = 0; i < 50 && t.fake.sim.lastRun!.status !== 'waiting_for_approval'; i++) await new Promise((r) => setTimeout(r, 20));
    const d = await runner().pass();
    expect([...d.values()]).toEqual([{ kind: 'wait' }]);
    expect((await goal(t, base)).status).toBe('active');
  });

  it('block only while active, gone after DELETE', async () => {
    const { t, base } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    await finish(t, base);
    await t.request('POST', `${base}/goal/pause`, { reason: 'button' });
    await t.request('POST', `${base}/runs`, { input: 'Un point à part' });
    expect(t.fake.sim.lastRun!.instructions).not.toContain('Objectif de la session');
    await finish(t, base);
    await t.request('POST', `${base}/goal/resume`);
    expect(t.fake.sim.lastRun!.instructions).toContain('Objectif de la session');
    await finish(t, base);
    expect((await t.request('DELETE', `${base}/goal`)).json.goal).toBeNull();
    await t.request('POST', `${base}/runs`, { input: 'Encore' });
    expect(t.fake.sim.lastRun!.instructions).not.toContain('Objectif de la session');
  });

  it('refuses: a goal during a run, no budget with « Sans confirmation », the relaunch prefix from the user', async () => {
    const { t, base } = await setup();
    const live = await t.request('POST', `${base}/runs`, { input: 'lent' });
    const during = await t.request('POST', `${base}/goal`, { text: 'objectif-1' });
    expect(during.status).toBe(409);
    expect(during.json.code).toBe('run_active');
    expect(await goal(t, base)).toBeNull();
    await t.request('POST', `${base}/runs/${live.json.runId}/stop`, {});
    await waitRun(t, base, live.json.runId);

    await t.request('PATCH', base, { autoApprove: true });
    const noBudget = await t.request('POST', `${base}/goal`, { text: 'objectif-1', budgetUsd: null });
    expect(noBudget.status).toBe(400);
    expect(noBudget.json.code).toBe('budget_required');
    await t.request('PATCH', base, { autoApprove: false });
    await t.request('POST', `${base}/goal`, { text: 'objectif-9', budgetUsd: null });
    const on = await t.request('PATCH', base, { autoApprove: true });
    expect(on.status).toBe(400);
    expect(on.json.code).toBe('goal_budget_required');
    await finish(t, base);

    const spoof = await t.request('POST', `${base}/runs`, { input: `  ${relaunchInput(1, 5)}` });
    expect(spoof.status).toBe(400);
    expect(spoof.json.code).toBe('reserved_prefix');
    expect((await t.request('POST', `${base}/goal`, { text: 'objectif-1' })).json.code).toBe('goal_exists');
  });

  it('deleted session: paused « gone »; a replacing copy takes the goal, its undo brings it back', async () => {
    const { t, s, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    await finish(t, base);
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-objectif-1', before: null, mode: 'replace' });
    const copy = res.json.session.id as string;
    expect(await goal(t, `/x/sessions/fake/${copy}`)).toMatchObject({ status: 'paused', reason: 'user', text: 'objectif-9' });
    await t.request('POST', `/x/sessions/fake/${copy}/revert`);
    expect(await goal(t, base)).toMatchObject({ status: 'paused', text: 'objectif-9' });

    await t.request('POST', `${base}/goal/resume`);
    await finish(t, base);
    t.services.workspaces.markDeleted('fake', [s.id]);
    await runner().pass();
    const row = t.services.goals.get('fake', s.id);
    expect(row).toMatchObject({ status: 'paused', reason: 'gone' });
  });

  it('a relaunch never starts for a goal paused or removed meanwhile (Codex P1)', async () => {
    const { t, s, base } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    await finish(t, base);
    await t.request('POST', `${base}/goal/pause`, { reason: 'button' });
    const ctx = t.services.workspaces.getSession('fake', s.id);
    const n = t.fake.sim.runs.size;
    await expect(startRun(t.services.runDeps, ctx, relaunchInput(1, 5), { forGoal: true })).rejects.toBeInstanceOf(GoalInactiveError);
    await t.request('DELETE', `${base}/goal`);
    await expect(startRun(t.services.runDeps, ctx, relaunchInput(1, 5), { forGoal: true })).rejects.toBeInstanceOf(GoalInactiveError);
    expect(t.fake.sim.runs.size).toBe(n);
  });

  it('two creations at the same time: one goal, never deleted by the other (Codex P2)', async () => {
    const { t, base } = await setup();
    const [a, b] = await Promise.all([
      t.request('POST', `${base}/goal`, { text: 'objectif-9 premier' }),
      t.request('POST', `${base}/goal`, { text: 'objectif-9 second' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = a.status === 200 ? 'objectif-9 premier' : 'objectif-9 second';
    expect(await goal(t, base)).toMatchObject({ status: 'active', text: won });
  });

  it('a run Hermes forgot pauses « lost »', async () => {
    const { t, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9' });
    await finish(t, base);
    t.fake.sim.runs.delete(await lastRunId(t, base));
    await runner().pass();
    expect(await goal(t, base)).toMatchObject({ status: 'paused', reason: 'lost' });
  });
});

describe('goal relaunch keys (Idempotency-Key)', () => {
  const NOT_DURABLE = { runs_idempotency: { supported: true, durable: false } };
  const keys = async (t: T) => ((await (await t.fake.api.request('/_fake/runs/last')).json()) as { postedKeys: string[] }).postedKeys;
  const rows = (t: T, sid: string) => t.fake && t.services.workspaces.runStats('fake', sid, { running: true });
  const stored = (t: T, sid: string) => t.services.goals.get('fake', sid)!;

  it('a slow admission: one run per relaunch, the same key for the same relaunch', async () => {
    resetSentBodies();
    const { t, s, base, runner } = await setup({ createRunTimeoutMs: 300 });
    const res = await t.request('POST', `${base}/goal`, { text: 'objectif-3 admission-lente', budgetUsd: null });
    expect(res.status).toBe(200);
    const first = res.json.runId as string;
    expect(await drive(t, base, runner())).toMatchObject({ status: 'done', relaunches: 2 });
    expect(t.fake.sim.runsPosted).toBe(3);
    expect(rows(t, s.id)).toHaveLength(3);
    const posted = await keys(t);
    // each one sent twice (timeout, then the retry Hermes replays)
    expect(posted).toHaveLength(6);
    expect(new Set(posted).size).toBe(3);
    expect(posted).toContain(`${s.id}:${goalKeySuffix(stored(t, s.id), first, 1)}`);
    expect(goalKeySuffix(stored(t, s.id), first, 1)).toBe(goalKeySuffix(stored(t, s.id), first, 1));
    expect(goalKeySuffix(stored(t, s.id), first, 1)).not.toBe(goalKeySuffix(stored(t, s.id), first, 2));
  });

  it('a relaunch lost by a timeout, then a restart: the next pass replays it, one run and one row', async () => {
    resetSentBodies();
    const { t, s, base, runner } = await setup({ features: NOT_DURABLE });
    // the first turn waits for its slow admission; the relaunches time out
    expect((await t.request('POST', `${base}/goal`, { text: 'objectif-9 admission-lente', budgetUsd: null })).status).toBe(200);
    await finish(t, base);
    t.services.runDeps.createRunTimeoutMs = 300;
    const before = t.fake.sim.runsPosted;
    await runner().pass(); // 504: the relaunch exists at Hermes, not at Intendia
    expect(t.fake.sim.runsPosted).toBe(before + 1);
    const nRows = rows(t, s.id).length;
    resetSentBodies();
    await runner().pass();
    expect(t.fake.sim.runsPosted).toBe(before + 1);
    expect(rows(t, s.id)).toHaveLength(nRows + 1);
    expect((await goal(t, base)).relaunches).toBe(1);
  });

  it('Hermes refuses the relaunch key: paused key_conflict, key_attempt 1, the resume sends another key', async () => {
    resetSentBodies();
    const { t, s, base, runner } = await setup({ features: NOT_DURABLE });
    await t.request('POST', `${base}/goal`, { text: 'objectif-9', budgetUsd: null });
    await finish(t, base);
    const first = await lastRunId(t, base);
    // the relaunch admitted at Hermes, not recorded (Intendia stopped meanwhile); then the instructions change
    const key = `${s.id}:${goalKeySuffix(stored(t, s.id), first, 1)}`;
    await t.fake.api.request('/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, Authorization: `Bearer ${t.inst.apiKey}` },
      body: JSON.stringify({ input: 'autre corps', session_id: s.id }),
    });
    await runner().pass();
    expect(await goal(t, base)).toMatchObject({ status: 'paused', reason: 'key_conflict' });
    expect(stored(t, s.id).keyAttempt).toBe(1);
    expect((await t.request('POST', `${base}/goal/resume`)).status).toBe(200);
    const last = (await keys(t)).at(-1)!;
    expect(last).not.toBe(key);
    expect(last).toBe(`${s.id}:${goalKeySuffix(stored(t, s.id), first, 1)}`);
  });

  it('the resume route sends the key of the loop for the same (run, rank)', async () => {
    resetSentBodies();
    const { t, s, base, runner } = await setup();
    await t.request('POST', `${base}/goal`, { text: 'objectif-9', mode: 'click' });
    expect(await drive(t, base, runner())).toMatchObject({ status: 'paused', reason: 'click', relaunches: 0 });
    const first = await lastRunId(t, base);
    await t.request('POST', `${base}/goal/resume`);
    expect((await keys(t)).at(-1)).toBe(`${s.id}:${goalKeySuffix(stored(t, s.id), first, 1)}`);
  });

  it('a creation sent again with the same clientKey after an error starts one run', async () => {
    resetSentBodies();
    const { t, s, base } = await setup({ createRunTimeoutMs: 300, features: NOT_DURABLE });
    const body = { text: 'objectif-9 admission-lente', budgetUsd: null, clientKey: 'goalkey-0001' };
    expect((await t.request('POST', `${base}/goal`, body)).status).toBe(504);
    expect(await goal(t, base)).toBeNull();
    const again = await t.request('POST', `${base}/goal`, body);
    expect(again.status).toBe(200);
    expect(t.fake.sim.runsPosted).toBe(1);
    expect(new Set(await keys(t))).toEqual(new Set([`${s.id}:goal-new-goalkey-0001`]));
  });
});

