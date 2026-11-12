import { describe, expect, it } from 'vitest';
import { kanbanMissions } from '../src/db/schema.js';
import { HermesError } from '../src/hermes/http.js';
import { HOLD_REASON, MissionService, SETTLE_MS } from '../src/kanban/missions.js';
import type { KanbanService } from '../src/kanban/service.js';
import { testApp } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;
const K = '/x/i/fake/kanban';
const board = (t: T) => t.fake.kanban.boards.get('default')!;
const byTitle = (t: T, title: string) => board(t).tasks.find((x) => x.title === title)!;
const patches = (t: T, id: string) => t.fake.requests.filter((r) => r.method === 'PATCH' && r.path === `/api/plugins/kanban/tasks/${id}`);

async function mission(t: T, goal: string) {
  const res = await t.request('POST', `${K}/missions?board=default`, { goal, body: 'Consigne de départ' });
  expect(res.status).toBe(202);
  expect(res.json.mission.state).toBe('decomposing');
  await t.services.missions.idle(res.json.mission.id);
  return (await t.request('GET', `${K}/missions/${res.json.mission.id}`)).json.mission;
}

/** A clock that moves only when the service sleeps. */
function clock() {
  let at = 1_000_000;
  return { now: () => at, sleep: async (ms: number) => { at += ms; } };
}

describe('supervised missions', () => {
  it('holds every child in scheduled with Intendia’s reason, the root waiting for them', async () => {
    const t = await testApp();
    const m = await mission(t, 'Préparer la mission annuelle');
    expect(m.state).toBe('held');
    expect(m.rootStatus).toBe('todo');
    expect(m.children.map((c: any) => [c.title, c.status, c.held])).toEqual([
      ['Rassembler les sources', 'scheduled', true], ['Interroger les équipes', 'scheduled', true], ['Rédiger la synthèse', 'scheduled', true],
    ]);
    const a = byTitle(t, 'Rassembler les sources');
    expect(m.children[2].after).toEqual([a.id]);
    expect(patches(t, a.id).at(-1)!.body).toEqual({ status: 'scheduled', block_reason: HOLD_REASON });
    const root = byTitle(t, 'Préparer la mission annuelle');
    expect(root.body).toBe('Consigne de départ');
    // the reason reads back in the task detail
    expect((await t.request('GET', `${K}/tasks/${a.id}?board=default`)).json.blockReason).toBe(HOLD_REASON);
    expect((await t.request('GET', `${K}/missions?board=default`)).json.missions.map((x: any) => x.id)).toEqual([m.id]);
  });

  it('leaves a child already running alone (« déjà lancée »)', async () => {
    const t = await testApp();
    const m = await mission(t, 'mission-course rapide');
    const a = m.children.find((c: any) => c.title === 'Rassembler les sources');
    expect(a).toMatchObject({ status: 'running', held: false });
    expect(patches(t, a.id)).toHaveLength(0);
    expect(m.children.filter((c: any) => c.held)).toHaveLength(2);
  });

  it('fails without children: ok:false (no auxiliary model) or fanout:false', async () => {
    const t = await testApp();
    const r = await t.request('POST', `${K}/missions?board=default`, { goal: 'Un but sans modèle' });
    await t.services.missions.idle(r.json.mission.id);
    const failed = (await t.request('GET', `${K}/missions/${r.json.mission.id}`)).json.mission;
    expect(failed).toMatchObject({ state: 'failed', children: [] });
    expect(failed.error).toMatch(/AuxiliaryClientUnavailable/);
    expect(byTitle(t, 'Un but sans modèle').status).toBe('triage');
    const s = await mission(t, 'mission-seule');
    expect(s.state).toBe('failed');
    expect(s.error).toMatch(/pas découpé/);
  });

  it('refuses a goal too long and a missing op (409 without code) before writing anything', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${K}/missions?board=default`, { goal: 'x'.repeat(201) })).status).toBe(400);
    const mod = t.compat.get('fake')!.modules.find((x) => x.id === 'kanban')!;
    mod.ops.decompose = { ...mod.ops.decompose!, ok: false };
    const res = await t.request('POST', `${K}/missions?board=default`, { goal: 'mission impossible' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBeUndefined();
    expect(t.db.select().from(kanbanMissions).all()).toHaveLength(0);
  });

  it('answer lost: the root is re-read until its children show, then they are held', async () => {
    const t = await testApp();
    const real = t.services.kanban;
    const lossy = Object.create(real) as KanbanService;
    lossy.aux = async (...args: Parameters<KanbanService['aux']>) => {
      await real.aux(...args);
      throw new HermesError('timeout', 'délai dépassé');
    };
    const c = clock();
    const svc = new MissionService(t.db, lossy, { ...c, log: () => {} });
    const row = svc.create('fake', 'default', { goal: 'Mission perdue' });
    await svc.idle(row.id);
    const m = await svc.get('fake', row.id);
    expect(m.state).toBe('held');
    expect(m.children.every((x) => x.held)).toBe(true);
  });

  it('answer lost and nothing split: failed after 210 s, not before', async () => {
    const t = await testApp();
    const lossy = Object.create(t.services.kanban) as KanbanService;
    lossy.aux = async () => { throw new HermesError('network', 'coupé'); };
    const c = clock();
    const start = c.now();
    const svc = new MissionService(t.db, lossy, { ...c, log: () => {} });
    const row = svc.create('fake', 'default', { goal: 'Mission coupée' });
    await svc.idle(row.id);
    const m = await svc.get('fake', row.id);
    expect(m.state).toBe('failed');
    expect(m.error).toMatch(/interrompu/);
    expect(c.now() - start).toBe(SETTLE_MS);
  });

  it('resumes a split cut by a stop of Intendia', async () => {
    const t = await testApp();
    const root = (await t.request('POST', `${K}/tasks?board=default`, { title: 'Mission reprise', start: 'triage' })).json.task;
    await t.request('POST', `${K}/tasks/${root.id}/decompose?board=default`);
    const now = Date.now();
    t.db.insert(kanbanMissions).values({
      id: 'm_0123456789ab', instanceId: 'fake', board: 'default', rootId: root.id, goal: 'Mission reprise', state: 'decomposing',
      error: null, decomposeStartedAt: now - 300_000, createdAt: now - 300_000, updatedAt: now,
    }).run();
    const svc = new MissionService(t.db, t.services.kanban, { log: () => {} });
    svc.resume();
    await svc.idle('m_0123456789ab');
    const m = await svc.get('fake', 'm_0123456789ab');
    expect(m.state).toBe('held');
    expect(m.children).toHaveLength(3);
  });

  it('launch: held children to ready (todo while a parent is not finished), then one dispatch', async () => {
    const t = await testApp();
    const m = await mission(t, 'Mission à lancer');
    const before = t.fake.requests.length;
    const res = await t.request('POST', `${K}/missions/${m.id}/launch`);
    expect(res.status).toBe(200);
    expect(res.json.mission.state).toBe('launched');
    const after = t.fake.requests.slice(before);
    expect(after.filter((r) => r.method === 'PATCH').map((r) => r.body)).toEqual([{ status: 'ready' }, { status: 'ready' }, { status: 'ready' }]);
    expect(after.filter((r) => r.path === '/api/plugins/kanban/dispatch')).toHaveLength(1);
    expect(byTitle(t, 'Rédiger la synthèse').status).toBe('todo');
    expect(['ready', 'running']).toContain(byTitle(t, 'Rassembler les sources').status);
    const again = await t.request('POST', `${K}/missions/${m.id}/launch`);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('mission_state');
  });

  it('remove: refused while another held child waits for it and for the last one, archived otherwise', async () => {
    const t = await testApp();
    const m = await mission(t, 'Mission à réduire');
    const [a, b, c] = m.children;
    const dep = await t.request('DELETE', `${K}/missions/${m.id}/children/${a.id}`);
    expect(dep.status).toBe(409);
    expect(dep.json.code).toBe('mission_dependency');
    expect((await t.request('DELETE', `${K}/missions/${m.id}/children/${b.id}`)).json.mission.children.find((x: any) => x.id === b.id)).toMatchObject({ status: 'archived', held: false });
    expect((await t.request('DELETE', `${K}/missions/${m.id}/children/${c.id}`)).status).toBe(200);
    const last = await t.request('DELETE', `${K}/missions/${m.id}/children/${a.id}`);
    expect(last.status).toBe(409);
    expect(last.json.code).toBe('mission_last');
    expect((await t.request('DELETE', `${K}/missions/${m.id}/children/${b.id}`)).status).toBe(404);
    await t.request('POST', `${K}/missions/${m.id}/launch`);
    const late = await t.request('DELETE', `${K}/missions/${m.id}/children/${a.id}`);
    expect(late.json.code).toBe('mission_state');
  });

  it('cancel: the root archived before the children, the mission left out of the list', async () => {
    const t = await testApp();
    const m = await mission(t, 'Mission annulée');
    const root = byTitle(t, 'Mission annulée');
    const before = t.fake.requests.length;
    expect((await t.request('POST', `${K}/missions/${m.id}/cancel`)).json.mission.state).toBe('cancelled');
    const archived = t.fake.requests.slice(before).filter((r) => r.method === 'PATCH').map((r) => r.path.split('/').at(-1));
    expect(archived[0]).toBe(root.id);
    expect(archived).toHaveLength(4);
    expect(board(t).tasks.every((x) => x.status === 'archived')).toBe(true);
    expect((await t.request('GET', `${K}/missions?board=default`)).json.missions).toEqual([]);
    expect((await t.request('GET', `${K}/missions/m_ffffffffffff`)).status).toBe(404);
    expect((await t.request('GET', `${K}/missions/pas-une-mission`)).status).toBe(400);
  });
});
