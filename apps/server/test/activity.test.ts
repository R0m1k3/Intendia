import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessionWorkspace } from '../src/db/schema.js';
import { testApp, waitRun } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;
const AUTH = { Authorization: 'Bearer fake-dashboard-token', 'Content-Type': 'application/json' };

async function session(t: T, slug = 'dev') {
  if ((await t.request('GET', `/x/workspaces/${slug}`)).status === 404) {
    expect((await t.request('POST', '/x/workspaces', { slug, name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  }
  const s = (await t.request('POST', `/x/workspaces/${slug}/sessions`)).json.session;
  return { s, base: `/x/sessions/fake/${s.id}` };
}

async function dispatchTask(t: T, title: string, board = 'default') {
  const res = await t.fake.dash.request(`/api/plugins/kanban/tasks?board=${board}`, { method: 'POST', headers: AUTH, body: JSON.stringify({ title, assignee: 'default' }) });
  const { task } = (await res.json()) as { task: { id: string } };
  await t.fake.dash.request(`/api/plugins/kanban/dispatch?board=${board}`, { method: 'POST', headers: AUTH });
  return task.id;
}

const runStatusCalls = (t: T, runId: string) => t.fake.requests.filter((r) => r.method === 'GET' && r.path === `/v1/runs/${runId}`).length;

describe('activity', () => {
  it('lists a run in progress and drops it once finished, without asking again', async () => {
    const t = await testApp({ stepMs: 30 });
    const { s, base } = await session(t);
    const runId = (await t.request('POST', `${base}/runs`, { input: 'lent' })).json.runId as string;

    const during = (await t.request('GET', '/x/i/fake/activity')).json;
    expect(during.runs).toMatchObject([{ instance: 'fake', workspace: 'dev', sessionId: s.id, runId, profile: 'default' }]);
    expect(['queued', 'running']).toContain(during.runs[0].status);

    await t.request('POST', `${base}/runs/${runId}/stop`);
    await waitRun(t, base, runId);
    expect((await t.request('GET', '/x/i/fake/activity')).json.runs).toEqual([]);
    const calls = runStatusCalls(t, runId);
    await t.request('GET', '/x/i/fake/activity');
    expect(runStatusCalls(t, runId)).toBe(calls);
  });

  it('drops a run Hermes no longer knows (404) and sessions older than 24 h', async () => {
    const t = await testApp();
    const a = await session(t);
    const b = await session(t);
    t.db.update(sessionWorkspace).set({ lastRunId: 'run_oublie', lastActiveAt: Date.now() }).where(eq(sessionWorkspace.sessionId, a.s.id)).run();
    t.db.update(sessionWorkspace).set({ lastRunId: 'run_vieux', lastActiveAt: Date.now() - 25 * 3600_000 }).where(eq(sessionWorkspace.sessionId, b.s.id)).run();
    const res = (await t.request('GET', '/x/i/fake/activity')).json;
    expect(res).toEqual({ runs: [], workers: [], errors: [] });
    expect(runStatusCalls(t, 'run_vieux')).toBe(0);
    expect(runStatusCalls(t, 'run_oublie')).toBe(1);
    await t.request('GET', '/x/i/fake/activity');
    expect(runStatusCalls(t, 'run_oublie')).toBe(1);
  });

  it('reaches an older run still going once 20 newer runs are known as finished', async () => {
    const t = await testApp({ stepMs: 100 });
    const live = await session(t);
    const runId = (await t.request('POST', `${live.base}/runs`, { input: 'lent' })).json.runId as string;
    t.db.update(sessionWorkspace).set({ lastActiveAt: Date.now() - 3600_000 }).where(eq(sessionWorkspace.sessionId, live.s.id)).run();
    for (let i = 0; i < 20; i++) {
      const o = await session(t);
      t.db.update(sessionWorkspace).set({ lastRunId: `run_fini_${i}`, lastActiveAt: Date.now() }).where(eq(sessionWorkspace.sessionId, o.s.id)).run();
    }
    // first pass: the 20 newer runs fill the checks (Hermes no longer knows them)
    expect((await t.request('GET', '/x/i/fake/activity')).json.runs).toEqual([]);
    // second pass: they are skipped before the limit, the older run is checked
    expect((await t.request('GET', '/x/i/fake/activity')).json.runs).toMatchObject([{ runId, sessionId: live.s.id }]);
    await t.request('POST', `${live.base}/runs/${runId}/stop`);
  });

  it('reports an unreachable instance as an error line', async () => {
    const t = await testApp();
    const { s } = await session(t);
    t.db.update(sessionWorkspace).set({ lastRunId: 'run_x', lastActiveAt: Date.now() }).where(eq(sessionWorkspace.sessionId, s.id)).run();
    const res = (await t.request('GET', '/x/i/fake/activity', undefined)).json;
    expect(res.errors).toEqual([]);
    const t2 = await testApp({ breaks: { 'api GET /v1/runs/run_x': { status: 500 } } });
    const { s: s2 } = await session(t2);
    t2.db.update(sessionWorkspace).set({ lastRunId: 'run_x', lastActiveAt: Date.now() }).where(eq(sessionWorkspace.sessionId, s2.id)).run();
    const res2 = (await t2.request('GET', '/x/i/fake/activity')).json;
    expect(res2.runs).toEqual([]);
    expect(res2.errors).toHaveLength(1);
    expect(res2.errors[0].instance).toBe('fake');
  });

  it('lists the kanban workers of every live board', async () => {
    const t = await testApp();
    await t.fake.dash.request('/api/plugins/kanban/boards', { method: 'POST', headers: AUTH, body: JSON.stringify({ slug: 'ventes', name: 'Ventes' }) });
    const a = await dispatchTask(t, 'Inventaire stuck');
    const b = await dispatchTask(t, 'Relevé stuck', 'ventes');
    const res = (await t.request('GET', '/x/i/fake/activity')).json;
    expect(res.workers.map((w: any) => [w.board, w.taskId])).toEqual([['default', a], ['ventes', b]]);
    expect(t.fake.requests.filter((r) => r.path === '/api/plugins/kanban/workers/active' && r.query.board).map((r) => r.query.board)).toEqual(['default', 'ventes']);
  });
});

describe('stopping a kanban worker', () => {
  it('terminates the worker and blocks the task that Hermes put back in ready', async () => {
    const t = await testApp();
    const taskId = await dispatchTask(t, 'Analyse stuck');
    const [w] = (await t.request('GET', '/x/i/fake/activity')).json.workers;
    const res = await t.request('POST', `/x/i/fake/kanban/workers/${w.runId}/stop?board=default`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ taskId, status: 'blocked' });
    const term = t.fake.requests.find((r) => r.path === `/api/plugins/kanban/runs/${w.runId}/terminate`)!;
    expect(term.query).toEqual({ board: 'default' });
    expect(term.body).toEqual({ reason: 'Arrêté depuis Intendia' });
    const patch = t.fake.requests.find((r) => r.method === 'PATCH' && r.path === `/api/plugins/kanban/tasks/${taskId}`)!;
    expect(patch.body).toEqual({ status: 'blocked', block_reason: 'Arrêtée depuis Intendia' });
    expect((await t.request('GET', '/x/i/fake/activity')).json.workers).toEqual([]);
  });

  it('says when the worker already ended or is unknown (409 worker_ended)', async () => {
    const t = await testApp({ kanbanStepMs: 10 });
    const unknown = await t.request('POST', '/x/i/fake/kanban/workers/999/stop?board=default');
    expect(unknown.status).toBe(409);
    expect(unknown.json.code).toBe('worker_ended');
    await dispatchTask(t, 'Courte');
    const runId = t.fake.kanban.boards.get('default')!.events.find((e) => e.kind === 'spawned')!.run_id;
    await new Promise((r) => setTimeout(r, 50));
    const ended = await t.request('POST', `/x/i/fake/kanban/workers/${runId}/stop?board=default`);
    expect(ended.json.code).toBe('worker_ended');
  });

  it('leaves a task Hermes put in review', async () => {
    const t = await testApp();
    const taskId = await dispatchTask(t, 'Revue stuck');
    const [w] = (await t.request('GET', '/x/i/fake/activity')).json.workers;
    // Hermes' retry status can be review: simulate it by moving the task before the read that follows terminate
    const orig = t.fake.kanban.handle.bind(t.fake.kanban);
    t.fake.kanban.handle = (via, method, path, query, body) => {
      const out = orig(via, method, path, query, body);
      if (path.endsWith('/terminate')) {
        const task = t.fake.kanban.boards.get('default')!.tasks.find((x) => x.id === taskId)!;
        task.status = 'review';
      }
      return out;
    };
    const res = await t.request('POST', `/x/i/fake/kanban/workers/${w.runId}/stop?board=default`);
    expect(res.json).toEqual({ taskId, status: 'review' });
    expect(t.fake.requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('reports a task restarted by Hermes before it could be blocked (409 task_restarted)', async () => {
    const t = await testApp({ breaks: { 'dash PATCH /api/plugins/kanban/tasks/t_fake0001': { status: 400, body: { detail: "cannot move t_fake0001 from 'running' to 'blocked'" } } } });
    await dispatchTask(t, 'Course stuck');
    const [w] = (await t.request('GET', '/x/i/fake/activity')).json.workers;
    const res = await t.request('POST', `/x/i/fake/kanban/workers/${w.runId}/stop?board=default`);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('task_restarted');
  });

  it('validates the board and the run id before calling Hermes', async () => {
    const t = await testApp();
    expect((await t.request('POST', '/x/i/fake/kanban/workers/12/stop')).status).toBe(400);
    expect((await t.request('POST', '/x/i/fake/kanban/workers/12/stop?board=../x')).status).toBe(400);
    expect((await t.request('POST', '/x/i/fake/kanban/workers/abc/stop?board=default')).status).toBe(400);
    expect(t.fake.requests.some((r) => r.path.includes('/terminate'))).toBe(false);
  });
});

describe('activity per instance', () => {
  it('lists only the instance\'s runs; unknown instance → 404', async () => {
    const t = await testApp({ stepMs: 30, extra: [{ id: 'b', label: 'Bureau' }] });
    const { base } = await session(t);
    expect((await t.request('POST', '/x/workspaces', { slug: 'bur', name: 'Bur', instanceId: 'b' })).status).toBe(201);
    const sb = (await t.request('POST', '/x/workspaces/bur/sessions')).json.session;
    const runA = (await t.request('POST', `${base}/runs`, { input: 'lent' })).json.runId as string;
    const runB = (await t.request('POST', `/x/sessions/b/${sb.id}/runs`, { input: 'lent' })).json.runId as string;
    expect((await t.request('GET', '/x/i/fake/activity')).json.runs.map((r: { runId: string }) => r.runId)).toEqual([runA]);
    expect((await t.request('GET', '/x/i/b/activity')).json.runs.map((r: { runId: string }) => r.runId)).toEqual([runB]);
    expect((await t.request('GET', '/x/i/inconnue/activity')).status).toBe(404);
    expect((await t.request('GET', '/x/activity')).status).toBe(404);
  });
});

describe('approvals of every instance', () => {
  const eventsCalls = (t: T, runId: string) => t.fake.requests.filter((r) => r.method === 'GET' && r.path === `/v1/runs/${runId}/events`).length;
  async function waiting(t: T, inst: string, sessionId: string, runId: string) {
    while ((await t.request('GET', `/x/sessions/${inst}/${sessionId}/runs/${runId}`)).json.status !== 'waiting_for_approval') await new Promise((r) => setTimeout(r, 5));
  }

  it('gives the question of a run of another instance, shares the result, and drops it once answered', async () => {
    const t = await testApp({ extra: [{ id: 'b', label: 'Bureau' }] });
    expect((await t.request('POST', '/x/workspaces', { slug: 'bur', name: 'Bur', instanceId: 'b' })).status).toBe(201);
    const s = (await t.request('POST', '/x/workspaces/bur/sessions')).json.session;
    const runId = (await t.request('POST', `/x/sessions/b/${s.id}/runs`, { input: 'approval svp' })).json.runId as string;
    await waiting(t, 'b', s.id, runId);

    const res = (await t.request('GET', '/x/approvals')).json;
    expect(res.approvals).toMatchObject([{
      key: `${runId}:apr_1`, instanceId: 'b', instanceLabel: 'Bureau', workspace: 'bur', sessionId: s.id, runId,
      requestId: 'apr_1', command: 'rm -rf build/', choices: ['once', 'session', 'always', 'deny'], canAnswer: true,
    }]);
    await t.request('GET', '/x/approvals');
    expect(eventsCalls(t, runId)).toBe(1);

    expect((await t.request('POST', `/x/sessions/b/${s.id}/runs/${runId}/approval`, { choice: 'once', requestId: 'apr_1' })).status).toBe(200);
    expect((await t.services.activity.approvals(Date.now() + 10_000)).approvals).toEqual([]);
  });

  it('a waiting run whose question was lost from the replay comes without question nor choices', async () => {
    const t = await testApp({ retainFrom: 1_000_000 });
    const { s, base } = await session(t);
    const runId = (await t.request('POST', `${base}/runs`, { input: 'approval svp' })).json.runId as string;
    await waiting(t, 'fake', s.id, runId);
    expect((await t.request('GET', '/x/approvals')).json.approvals).toMatchObject([
      { key: `${runId}:attente`, command: null, description: null, choices: [], requestId: null },
    ]);
  });
});
