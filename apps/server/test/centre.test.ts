import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { runStats, sessionWorkspace } from '../src/db/schema.js';
import { testApp } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;

async function session(t: T, slug: string, instanceId: string) {
  if ((await t.request('GET', `/x/workspaces/${slug}`)).status === 404) {
    expect((await t.request('POST', '/x/workspaces', { slug, name: slug.toUpperCase(), instanceId })).status).toBe(201);
  }
  return (await t.request('POST', `/x/workspaces/${slug}/sessions`)).json.session as { id: string };
}

const HOUR = 3600_000;
function stat(t: T, instanceId: string, sessionId: string, runId: string, f: { status?: string; endedAt?: number | null; costUsd?: number | null } = {}) {
  const now = Date.now();
  t.db.insert(runStats).values({
    instanceId, runId, sessionId, status: f.status ?? 'completed', startedAt: now - 2 * HOUR,
    endedAt: f.endedAt === undefined ? now - HOUR : f.endedAt, costUsd: f.costUsd ?? null,
  }).run();
}

describe('Centre: every instance', () => {
  it('lists the runs of every instance in one pass, an unreachable one as an error line', async () => {
    const t = await testApp({ extra: [{ id: 'b', label: 'Bureau' }], breaks: { 'api GET /v1/runs/run_panne': { status: 500 } } });
    const a = await session(t, 'dev', 'fake');
    const b = await session(t, 'bur', 'b');
    const runB = (await t.request('POST', `/x/sessions/b/${b.id}/runs`, { input: 'lent' })).json.runId as string;
    t.db.update(sessionWorkspace).set({ lastRunId: 'run_panne', lastActiveAt: Date.now() }).where(eq(sessionWorkspace.sessionId, a.id)).run();

    const [one, two] = await Promise.all([t.request('GET', '/x/activity'), t.request('GET', '/x/activity')]);
    expect(one.json).toEqual(two.json);
    expect(one.json.runs).toMatchObject([{ instance: 'b', runId: runB, sessionId: b.id }]);
    expect(one.json.errors).toMatchObject([{ instance: 'fake' }]);
    // shared pass: the broken run was asked once for both readers
    expect(t.fake.requests.filter((r) => r.path === '/v1/runs/run_panne').length).toBe(1);
    await t.request('POST', `/x/sessions/b/${b.id}/runs/${runB}/stop`);
  });
});

describe('Centre: finished runs', () => {
  it('keeps the last 24 h of live sessions, newest first, without running runs or copies', async () => {
    const t = await testApp({ extra: [{ id: 'b', label: 'Bureau' }] });
    const a = await session(t, 'dev', 'fake');
    const gone = await session(t, 'dev', 'fake');
    const b = await session(t, 'bur', 'b');
    const now = Date.now();
    stat(t, 'fake', a.id, 'run_recent', { endedAt: now - HOUR, costUsd: 0.12 });
    stat(t, 'fake', a.id, 'run_older', { status: 'failed', endedAt: now - 3 * HOUR });
    stat(t, 'fake', a.id, 'run_old', { endedAt: now - 25 * HOUR });
    stat(t, 'fake', a.id, 'run_live', { status: 'running', endedAt: null });
    stat(t, 'fake', a.id, 'run_recent@copie');
    stat(t, 'fake', gone.id, 'run_deleted');
    t.db.update(sessionWorkspace).set({ deletedAt: now }).where(eq(sessionWorkspace.sessionId, gone.id)).run();
    stat(t, 'b', b.id, 'run_b', { endedAt: now - 2 * HOUR });

    const all = (await t.request('GET', '/x/activity/finished')).json.runs;
    expect(all.map((r: { runId: string }) => r.runId)).toEqual(['run_recent', 'run_b', 'run_older']);
    expect(all[0]).toMatchObject({ instance: 'fake', workspace: 'dev', workspaceName: 'DEV', sessionId: a.id, status: 'completed', costUsd: 0.12 });
    const onlyB = (await t.request('GET', '/x/activity/finished?instance=b')).json.runs;
    expect(onlyB.map((r: { runId: string }) => r.runId)).toEqual(['run_b']);
    expect((await t.request('GET', '/x/activity/finished?instance=inconnue')).status).toBe(404);
  });

  it('records the end of a run nobody followed when the activity sees it finished', async () => {
    const t = await testApp({ stepMs: 5 });
    const a = await session(t, 'dev', 'fake');
    const runId = (await t.request('POST', `/x/sessions/fake/${a.id}/runs`, { input: 'Bonjour' })).json.runId as string;
    expect((await t.request('GET', '/x/activity/finished')).json.runs).toEqual([]);
    await new Promise((r) => setTimeout(r, 400));
    await t.request('GET', '/x/i/fake/activity');
    const runs = (await t.request('GET', '/x/activity/finished')).json.runs;
    expect(runs).toMatchObject([{ runId, sessionId: a.id, status: 'completed' }]);
    expect(runs[0].endedAt).toBeGreaterThanOrEqual(runs[0].startedAt);
  });

  it('gives 50 rows at most', async () => {
    const t = await testApp();
    const a = await session(t, 'dev', 'fake');
    for (let i = 0; i < 55; i++) stat(t, 'fake', a.id, `run_${i}`, { endedAt: Date.now() - HOUR + i });
    const runs = (await t.request('GET', '/x/activity/finished')).json.runs;
    expect(runs).toHaveLength(50);
    expect(runs[0].runId).toBe('run_54');
  });
});
