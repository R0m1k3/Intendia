import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runStats, sessionWorkspace } from '../src/db/schema.js';
import { UNDO_MS } from '../src/workspaces/service.js';
import { testApp, waitRun } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;

async function setup() {
  const t = await testApp();
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}
const send = async (t: T, base: string, input: string) => {
  const r = await t.request('POST', `${base}/runs`, { input });
  await waitRun(t, base, r.json.runId);
};
const messages = async (t: T, id: string) => (await t.request('GET', `/x/sessions/fake/${id}/messages`)).json.messages as { id: number; role: string; content: string }[];
const users = async (t: T, id: string) => (await messages(t, id)).filter((m) => m.role === 'user');

describe('rewrite: edit, retry, undo, clear, branch', () => {
  it('replaces the session by a copy cut before a message, the original deleted with the undo window', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Premier');
    await send(t, base, 'Second');
    await t.request('PATCH', base, { title: 'Ventes', pinned: true });
    const second = (await users(t, s.id))[1]!;
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-modif-01', before: second.id, mode: 'replace' });
    expect(res.status).toBe(201);
    expect(res.json.replaced).toBe(s.id);
    expect(res.json.undoUntil).toBeGreaterThan(Date.now());
    const copy = res.json.session;
    expect(copy).toMatchObject({ title: 'Ventes', pinned: true, workspace: 'dev', replacesId: s.id, copiedFrom: s.id });
    expect((await users(t, copy.id)).map((m) => m.content)).toEqual(['Premier']);
    expect((await t.request('GET', base)).status).toBe(404);
    // the edited text is sent on the copy
    await send(t, `/x/sessions/fake/${copy.id}`, 'Second, corrigé');
    expect((await users(t, copy.id)).map((m) => m.content)).toEqual(['Premier', 'Second, corrigé']);
    // same key: same answer, nothing asked to Hermes
    const before = t.fake.requests.length;
    const again = await t.request('POST', `${base}/rewrite`, { key: 'cle-modif-01', before: second.id, mode: 'replace' });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ session: { id: copy.id }, replaced: s.id, undoUntil: res.json.undoUntil });
    expect(t.fake.requests.length).toBe(before);
    // a second replacement of the deleted original (a tab left open) is refused
    expect((await t.request('POST', `${base}/rewrite`, { key: 'cle-modif-02', before: null, mode: 'replace' })).status).toBe(404);
  });

  it('cut before the first message or clear: an empty session, no export', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Seul message');
    const first = (await users(t, s.id))[0]!;
    const n = t.fake.requests.length;
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-vider-01', before: 0, mode: 'replace' });
    expect(res.status).toBe(201);
    expect(res.json.session.copiedFrom).toBeNull();
    expect(t.fake.requests.slice(n).some((r) => r.path.endsWith('/export'))).toBe(false);
    expect((await t.request('GET', `/x/sessions/fake/${res.json.session.id}/messages`)).json.messages).toEqual([]);
    // the cut before the first message is the same
    await t.request('POST', `/x/sessions/fake/${res.json.session.id}/revert`);
    const retry = await t.request('POST', `${base}/rewrite`, { key: 'cle-retry-01', before: first.id, mode: 'replace' });
    expect(retry.status).toBe(201);
    expect(retry.json.session.copiedFrom).toBeNull();
    await send(t, `/x/sessions/fake/${retry.json.session.id}`, 'Seul message');
    expect((await users(t, retry.json.session.id)).map((m) => m.content)).toEqual(['Seul message']);
  });

  it('branch: the original unchanged, a new session "(branche)" up to the end of the turn', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Un');
    await send(t, base, 'Deux');
    await t.request('PATCH', base, { title: 'Piste' });
    const deux = (await users(t, s.id))[1]!;
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-branche-1', before: deux.id, mode: 'branch' });
    expect(res.status).toBe(201);
    expect(res.json.replaced).toBeUndefined();
    expect(res.json.session).toMatchObject({ title: 'Piste (branche)', replacesId: null });
    const kept = await messages(t, res.json.session.id);
    expect(kept.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['Un']);
    expect(kept.at(-1)!.role).toBe('assistant');
    expect((await t.request('GET', base)).status).toBe(200);
    expect(await users(t, s.id)).toHaveLength(2);
    // null = everything
    const all = await t.request('POST', `${base}/rewrite`, { key: 'cle-branche-2', before: null, mode: 'branch' });
    expect(await users(t, all.json.session.id)).toHaveLength(2);
  });

  it('refuses during a run, on a non-user or unknown message, and bad bodies', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Bonjour');
    const answer = (await messages(t, s.id)).find((m) => m.role === 'assistant')!;
    const bad = await t.request('POST', `${base}/rewrite`, { key: 'cle-mauvais-1', before: answer.id, mode: 'replace' });
    expect(bad.status).toBe(409);
    expect(bad.json.code).toBe('cut_not_found');
    expect((await t.request('POST', `${base}/rewrite`, { key: 'cle-mauvais-2', before: 99999, mode: 'replace' })).json.code).toBe('cut_not_found');
    expect((await t.request('POST', `${base}/rewrite`, { key: 'x', before: null, mode: 'replace' })).status).toBe(400);
    expect((await t.request('POST', `${base}/rewrite`, { key: 'cle-mauvais-3', before: -1, mode: 'replace' })).status).toBe(400);
    expect((await t.request('POST', `${base}/rewrite`, { key: 'cle-mauvais-4', before: null, mode: 'other' })).status).toBe(400);
    await t.request('POST', `${base}/runs`, { input: 'approval' });
    const busy = await t.request('POST', `${base}/rewrite`, { key: 'cle-run-0001', before: null, mode: 'branch' });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe('run_active');
  });

  it('refuses a reorientation as the cut point', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Bonjour');
    // a reorientation line as Hermes writes it
    t.fake.sim.messages.get(s.id)!.push({ id: 900, role: 'user', content: 'plutôt en bref', timestamp: Date.now() / 1000, display_kind: 'steer' } as never);
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-steer-001', before: 900, mode: 'replace' });
    expect(res.json.code).toBe('cut_not_found');
  });

  it('copies the cost lines of the kept replies only, frozen, under a new run id', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Un');
    await new Promise((r) => setTimeout(r, 1100));
    await send(t, base, 'Deux');
    const deux = (await users(t, s.id))[1]!;
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-couts-001', before: deux.id, mode: 'branch' });
    const rows = t.db.select().from(runStats).where(eq(runStats.sessionId, res.json.session.id)).all();
    const orig = t.db.select().from(runStats).where(eq(runStats.sessionId, s.id)).all();
    expect(orig).toHaveLength(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runId).toBe(`${orig[0]!.runId}@${res.json.session.id}`);
    expect(rows[0]!.costFinal).toBe(true);
  });
});

describe('revert', () => {
  it('brings the original back and deletes the copy; then too late', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Un');
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-annul-001', before: null, mode: 'replace' });
    const copy = res.json.session.id;
    const back = await t.request('POST', `/x/sessions/fake/${copy}/revert`);
    expect(back.status).toBe(200);
    expect(back.json.session.id).toBe(s.id);
    expect((await t.request('GET', base)).status).toBe(200);
    expect((await t.request('GET', `/x/sessions/fake/${copy}`)).status).toBe(404);
    const twice = await t.request('POST', `/x/sessions/fake/${copy}/revert`);
    expect(twice.status).toBe(409);
    expect(twice.json.code).toBe('too_late');
    // the same key after the undo
    const replay = await t.request('POST', `${base}/rewrite`, { key: 'cle-annul-001', before: null, mode: 'replace' });
    expect(replay.status).toBe(409);
    expect(replay.json.code).toBe('reverted');
  });

  it('stops the run of the copy first', { timeout: 20000 }, async () => {
    const { t, base } = await setup();
    await send(t, base, 'Un');
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-annul-002', before: null, mode: 'replace' });
    const copyBase = `/x/sessions/fake/${res.json.session.id}`;
    await t.request('POST', `${copyBase}/runs`, { input: 'approval' });
    const back = await t.request('POST', `${copyBase}/revert`);
    expect(back.status).toBe(200);
    expect(t.fake.requests.some((r) => r.path.endsWith('/stop'))).toBe(true);
  });

  it('too late after the window; undoUntil null on a replay once the original is purged', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Un');
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-annul-003', before: null, mode: 'replace' });
    t.db.update(sessionWorkspace).set({ deletedAt: Date.now() - UNDO_MS - 1 }).where(eq(sessionWorkspace.sessionId, s.id)).run();
    const late = await t.request('POST', `/x/sessions/fake/${res.json.session.id}/revert`);
    expect(late.json.code).toBe('too_late');
    // taken by the purger (deleted_at 0): the copy given back without banner
    t.db.update(sessionWorkspace).set({ deletedAt: 0 }).where(eq(sessionWorkspace.sessionId, s.id)).run();
    const replay = await t.request('POST', `${base}/rewrite`, { key: 'cle-annul-003', before: null, mode: 'replace' });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ session: { id: res.json.session.id }, undoUntil: null });
  });

  it('the purger leaves the original alone while the revert waits', async () => {
    const { t, s, base } = await setup();
    await send(t, base, 'Un');
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-annul-004', before: null, mode: 'replace' });
    const ws = t.services.workspaces;
    // the window nearly over, then held by the revert: not purgeable
    t.db.update(sessionWorkspace).set({ deletedAt: Date.now() - UNDO_MS + 50 }).where(eq(sessionWorkspace.sessionId, s.id)).run();
    expect(ws.holdWindow('fake', s.id)).toBe(true);
    expect(ws.claimPurgeable(Date.now() + 100, 20).map((p) => p.sessionId)).not.toContain(s.id);
    expect(res.json.session.id).toBeTruthy();
  });
});
