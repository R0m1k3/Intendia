import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp, waitRun } from './helpers.js';
import { UNDO_MS } from '../src/sessions/purge.js';

async function withWorkspace(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}

describe('sessions', () => {
  it('creates an Intendia session id, row and folder', async () => {
    const { t, s } = await withWorkspace();
    expect(s.id).toMatch(/^iw-dev-[a-z0-9]{12}$/);
    expect(s).toMatchObject({ instanceId: 'fake', workspace: 'dev', title: null, archived: false, lastRunId: null });
    expect(existsSync(join(t.root, 'dev', 'sessions', s.id))).toBe(true);
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions).toHaveLength(1);
  });

  it('stores model and effort per session and remembers them as the workspace last choice', async () => {
    const { t, base } = await withWorkspace();
    const res = await t.request('PATCH', base, { model: 'anthropic/claude-opus-4.6', effort: 'high' });
    expect(res.status).toBe(200);
    expect(res.json.session).toMatchObject({ model: 'anthropic/claude-opus-4.6', effort: 'high' });
    expect((await t.request('GET', '/x/workspaces/dev')).json.workspace).toMatchObject({ model: 'anthropic/claude-opus-4.6', effort: 'high' });
    // a new session of the workspace starts from that choice; the first one is unchanged by later edits
    const next = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    expect(next).toMatchObject({ model: 'anthropic/claude-opus-4.6', effort: 'high' });
    await t.request('PATCH', `/x/sessions/fake/${next.id}`, { model: null });
    expect((await t.request('GET', base)).json.session.model).toBe('anthropic/claude-opus-4.6');
    expect((await t.request('GET', '/x/workspaces/dev')).json.workspace).toMatchObject({ model: null, effort: 'high' });
  });

  it('refuses an unknown effort and a model name with spaces or line breaks', async () => {
    const { t, base } = await withWorkspace();
    expect((await t.request('PATCH', base, { effort: 'turbo' })).status).toBe(400);
    expect((await t.request('PATCH', base, { model: 'a\nb' })).status).toBe(400);
    expect((await t.request('PATCH', base, { model: 'x'.repeat(201) })).status).toBe(400);
    expect((await t.request('GET', base)).json.session).toMatchObject({ model: null, effort: null });
  });

  it('fills the title from the first message and pushes renames to Hermes', async () => {
    const { t, base, s } = await withWorkspace();
    const sent = await t.request('POST', `${base}/runs`, { input: '  Prépare   le rapport des ventes de la semaine pour les deux magasins, avec les marges  ' });
    const title = sent.json.session.title as string;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/^Prépare le rapport des ventes de la .*…$/);
    await waitRun(t, base, sent.json.runId);
    await t.request('POST', `${base}/runs`, { input: 'Autre chose' });
    expect((await t.request('GET', base)).json.session.title).toMatch(/^Prépare/);

    const renamed = await t.request('PATCH', base, { title: 'Ventes S45' });
    expect(renamed.json.session.title).toBe('Ventes S45');
    const patch = t.fake.requests.filter((r) => r.method === 'PATCH' && r.path === `/api/sessions/${s.id}`).at(-1);
    expect(patch?.body).toEqual({ title: 'Ventes S45' });
  });

  it('ignores a failed title push (session not at Hermes yet)', async () => {
    const { t, base } = await withWorkspace();
    const res = await t.request('PATCH', base, { title: 'Sans message' });
    expect(res.status).toBe(200);
    expect(res.json.session.title).toBe('Sans message');
  });

  it('sorts by activity, archives and deletes', async () => {
    const { t, s: first, base } = await withWorkspace();
    const second = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const run = await t.request('POST', `${base}/runs`, { input: 'bonjour' });
    await waitRun(t, base, run.json.runId);
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions.map((x: any) => x.id)).toEqual([first.id, second.id]);

    await t.request('PATCH', `/x/sessions/fake/${second.id}`, { archived: true });
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions).toHaveLength(1);
    expect((await t.request('GET', '/x/workspaces/dev/sessions?archived=1')).json.sessions).toHaveLength(1);

    // deletion with undo: hidden at once, deleted at Hermes only by the purger once the window is over
    const del = await t.request('DELETE', base);
    expect(del.status).toBe(200);
    expect(del.json.undoUntil).toBeGreaterThan(Date.now());
    expect((await t.request('GET', base)).status).toBe(404);
    expect(t.fake.requests.some((r) => r.method === 'DELETE' && r.path === `/api/sessions/${first.id}`)).toBe(false);
    await t.services.purger.sweep(Date.now() + UNDO_MS);
    expect(t.fake.requests.some((r) => r.method === 'DELETE' && r.path === `/api/sessions/${first.id}`)).toBe(true);
    expect(existsSync(join(t.root, 'dev', 'sessions', first.id))).toBe(true);
    // never sent to Hermes: Hermes answers 404, the row goes anyway
    expect((await t.request('DELETE', `/x/sessions/fake/${second.id}`)).status).toBe(200);
    expect((await t.services.purger.sweep(Date.now() + UNDO_MS)).purged).toEqual([second.id]);
    // purged ids stay out of the restore
    expect((await t.request('POST', '/x/i/fake/sessions/restore', { ids: [second.id] })).status).toBe(409);
  });

  it('pins first, unarchives, and keeps both in Intendia only', async () => {
    const { t, s: first } = await withWorkspace();
    const second = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions[0].id).toBe(second.id);
    const pinned = await t.request('PATCH', `/x/sessions/fake/${first.id}`, { pinned: true });
    expect(pinned.json.session.pinned).toBe(true);
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions.map((x: any) => x.id)).toEqual([first.id, second.id]);
    await t.request('PATCH', `/x/sessions/fake/${first.id}`, { archived: true });
    await t.request('PATCH', `/x/sessions/fake/${first.id}`, { archived: false });
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions).toHaveLength(2);
    expect(t.fake.requests.some((r) => r.method === 'PATCH' && r.path.startsWith('/api/sessions/'))).toBe(false);
  });

  it('restores a deleted session inside the window, refuses after it, and hides it everywhere meanwhile', async () => {
    const { t, s, base } = await withWorkspace();
    const run = await t.request('POST', `${base}/runs`, { input: 'bonjour' });
    await waitRun(t, base, run.json.runId);
    const now = Date.now();
    await t.request('PATCH', base, { pinned: true });
    await t.request('DELETE', base);
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions).toHaveLength(0);
    expect((await t.request('GET', '/x/i/fake/sessions/recent')).json.sessions.some((x: any) => x.id === s.id)).toBe(false);
    expect(t.services.workspaces.recentRuns(now - 60_000, 10)).toHaveLength(0);
    // the session must not come back as one "from elsewhere"
    expect(t.services.workspaces.ownedIds('fake').has(s.id)).toBe(true);
    const back = await t.request('POST', '/x/i/fake/sessions/restore', { ids: [s.id] });
    expect(back.json.restored).toEqual([s.id]);
    expect((await t.request('GET', base)).json.session).toMatchObject({ pinned: true, lastRunId: run.json.runId });
    // after the window: too late, and the purger takes it
    t.services.workspaces.markDeleted('fake', [s.id], Date.now() - UNDO_MS - 1);
    const late = await t.request('POST', '/x/i/fake/sessions/restore', { ids: [s.id] });
    expect(late.status).toBe(409);
    expect(late.json.code).toBe('too_late');
  });

  it('keeps a failed purge hidden and retries it', async () => {
    const { t, base, s } = await withWorkspace();
    const run = await t.request('POST', `${base}/runs`, { input: 'bonjour' });
    await waitRun(t, base, run.json.runId);
    await t.request('DELETE', base);
    const logs: string[] = [];
    const { SessionPurger } = await import('../src/sessions/purge.js');
    const failing = new SessionPurger(t.services.workspaces, {
      http: () => ({ request: async () => { throw new Error('boom'); } }), get: t.compat.get.bind(t.compat),
    } as any, (l) => logs.push(l));
    expect((await failing.sweep(Date.now() + UNDO_MS)).failed).toEqual([s.id]);
    await failing.sweep(Date.now() + UNDO_MS + 1000);
    expect(logs).toHaveLength(1); // once a minute at most
    // taken by the purger: no longer restorable, still hidden
    expect((await t.request('POST', '/x/i/fake/sessions/restore', { ids: [s.id] })).status).toBe(409);
    expect((await t.request('GET', base)).status).toBe(404);
    // tried again a minute later
    expect((await t.services.purger.sweep(Date.now() + UNDO_MS + 30_000)).purged).toEqual([]);
    expect((await t.services.purger.sweep(Date.now() + UNDO_MS + 61_000)).purged).toEqual([s.id]);
  });

  it('does not let failing purges hold every slot of the sweep', async () => {
    const { t } = await withWorkspace();
    const ws = t.services.workspaces;
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) ids.push((await t.request('POST', '/x/workspaces/dev/sessions')).json.session.id);
    const t0 = Date.now();
    ws.markDeleted('fake', ids.slice(0, 20), t0);
    const { SessionPurger } = await import('../src/sessions/purge.js');
    const failing = new SessionPurger(ws, {
      http: () => ({ request: async () => { throw new Error('boom'); } }), get: t.compat.get.bind(t.compat),
    } as any, () => {});
    expect((await failing.sweep(t0 + UNDO_MS)).failed).toHaveLength(20);
    ws.markDeleted('fake', [ids[20]!], t0 + 1000);
    // the 20 failed rows are not due yet: the new one goes first
    expect((await t.services.purger.sweep(t0 + UNDO_MS + 2000)).purged).toEqual([ids[20]]);
  });

  it('refuses to delete or move a session while a run goes on', async () => {
    const { t, base, s } = await withWorkspace();
    await t.request('POST', '/x/workspaces', { slug: 'autre', name: 'Autre', instanceId: 'fake' });
    const run = await t.request('POST', `${base}/runs`, { input: 'approval' });
    expect(run.status).toBe(200);
    const del = await t.request('DELETE', base);
    expect(del.status).toBe(409);
    expect(del.json.code).toBe('run_active');
    const bulk = await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [s.id], action: 'delete' });
    expect(bulk.json.results).toEqual([{ id: s.id, ok: false, error: 'Un travail est en cours' }]);
    expect(bulk.json.undoUntil).toBeUndefined();
    const mv = await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [s.id], action: 'move', workspace: 'autre' });
    expect(mv.json.results[0]).toMatchObject({ ok: false, error: 'Un travail est en cours' });
  });

  it('refuses a deletion while a send is being started, and a send to a deleted session', async () => {
    const { t, base, s } = await withWorkspace();
    const { startingRuns, runKey } = await import('../src/chat/history.js');
    startingRuns.add(runKey('fake', s.id));
    try {
      expect((await t.request('DELETE', base)).status).toBe(409);
    } finally {
      startingRuns.delete(runKey('fake', s.id));
    }
    expect((await t.request('DELETE', base)).status).toBe(200);
    expect((await t.request('POST', `${base}/runs`, { input: 'bonjour' })).status).toBe(404);
  });

  it('runs bulk actions id by id', async () => {
    const { t, s: a } = await withWorkspace({ profileKeys: { pro: 'pro-key-0123456789abcdef' } });
    const b = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const c = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('POST', '/x/workspaces', { slug: 'autre', name: 'Autre', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces', { slug: 'pro', name: 'Pro', instanceId: 'fake', profile: 'pro' });
    const ids = [a.id, b.id, c.id];

    const arch = await t.request('POST', '/x/i/fake/sessions/bulk', { ids, action: 'archive' });
    expect(arch.json.results.every((r: any) => r.ok)).toBe(true);
    expect((await t.request('GET', '/x/workspaces/dev/sessions?archived=1')).json.sessions).toHaveLength(3);
    await t.request('POST', '/x/i/fake/sessions/bulk', { ids, action: 'unarchive' });
    await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [c.id], action: 'pin' });
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions[0].id).toBe(c.id);

    // move: other profile refused, files written by the agent refused, empty folder recreated
    writeFileSync(join(t.root, 'dev', 'sessions', b.id, 'note.md'), 'x');
    const other = await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [a.id], action: 'move', workspace: 'pro' });
    expect(other.json.results[0]).toEqual({ id: a.id, ok: false, error: 'Autre agent' });
    const mv = await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [a.id, b.id, 'iw-dev-inconnu'], action: 'move', workspace: 'autre' });
    expect(mv.json.results).toEqual([
      { id: a.id, ok: true },
      { id: b.id, ok: false, error: "Ses fichiers resteraient dans l'ancien workspace" },
      { id: 'iw-dev-inconnu', ok: false, error: 'Introuvable' },
    ]);
    expect((await t.request('GET', `/x/sessions/fake/${a.id}`)).json.session.workspace).toBe('autre');
    expect(existsSync(join(t.root, 'autre', 'sessions', a.id))).toBe(true);
    expect(existsSync(join(t.root, 'dev', 'sessions', a.id))).toBe(false);

    const del = await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [b.id, c.id], action: 'delete' });
    expect(del.json.undoUntil).toBeGreaterThan(Date.now());
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions).toHaveLength(0);
    expect((await t.request('POST', '/x/i/fake/sessions/restore', { ids: [b.id, c.id] })).json.restored.sort()).toEqual([b.id, c.id].sort());

    expect((await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [a.id, a.id], action: 'pin' })).status).toBe(400);
    expect((await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [a.id], action: 'move' })).status).toBe(400);
  });

  it('cleans up never used Intendia sessions with undo, never copies, pinned or used ones', async () => {
    const { t, s: used, base } = await withWorkspace();
    const run = await t.request('POST', `${base}/runs`, { input: 'bonjour' });
    await waitRun(t, base, run.json.runId);
    const old = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const pinned = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const copy = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const fresh = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${pinned.id}`, { pinned: true });
    const { sessionWorkspace } = await import('../src/db/schema.js');
    const { inArray, eq } = await import('drizzle-orm');
    const hourAgo = Date.now() - 2 * 60 * 60 * 1000;
    t.db.update(sessionWorkspace).set({ createdAt: hourAgo })
      .where(inArray(sessionWorkspace.sessionId, [used.id, old.id, pinned.id, copy.id])).run();
    t.db.update(sessionWorkspace).set({ copiedFrom: 'x' }).where(eq(sessionWorkspace.sessionId, copy.id)).run();

    expect((await t.request('GET', '/x/i/fake/sessions/cleanup')).json).toEqual({ unused: 1 });
    const done = await t.request('POST', '/x/i/fake/sessions/cleanup');
    expect(done.json.ids).toEqual([old.id]);
    expect((await t.request('GET', '/x/workspaces/dev/sessions')).json.sessions.map((x: any) => x.id).sort())
      .toEqual([used.id, pinned.id, copy.id, fresh.id].sort());
    expect((await t.request('POST', '/x/i/fake/sessions/restore', { ids: [old.id] })).json.restored).toEqual([old.id]);
    expect(t.fake.requests.some((r) => r.method === 'DELETE')).toBe(false);

    // a first message being sent keeps its session out of the clean-up
    await t.request('POST', '/x/i/fake/sessions/bulk', { ids: [old.id], action: 'unpin' });
    const { startingRuns, runKey } = await import('../src/chat/history.js');
    startingRuns.add(runKey('fake', old.id));
    try {
      expect((await t.request('POST', '/x/i/fake/sessions/cleanup')).json.ids).toEqual([]);
    } finally {
      startingRuns.delete(runKey('fake', old.id));
    }
  });

  it('lists other sessions without Intendia ones, with paging', async () => {
    const { t, base } = await withWorkspace();
    const run = await t.request('POST', `${base}/runs`, { input: 'bonjour' });
    await waitRun(t, base, run.json.runId);
    const page = (await t.request('GET', '/x/i/fake/other-sessions')).json;
    expect(page.sessions.map((s: any) => s.id)).toEqual(['intendia-probe-1']);
    expect(page.hasMore).toBe(false);
    const ext = await t.request('GET', '/x/i/fake/external/intendia-probe-1/messages');
    expect(ext.status).toBe(200);
    expect(ext.json.messages).toEqual([]); // the recorded session only has session_meta
    expect((await t.request('GET', '/x/i/fake/other-sessions?profile=inconnu')).status).toBe(400);
  });

  it('deletes a session born elsewhere at Hermes, never an Intendia one or what continues it', async () => {
    const { t, s, base } = await withWorkspace();
    const seed = (body: Record<string, unknown>) => t.fake.api.request('/_fake/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'telegram', title: null, ...body }),
    });
    await seed({ id: 'tg_1', messages: [{ role: 'user', content: 'Bonjour' }] });
    const del = await t.request('DELETE', '/x/i/fake/external/tg_1');
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ ok: true });
    expect((await t.request('GET', '/x/i/fake/other-sessions')).json.sessions.map((x: any) => x.id)).not.toContain('tg_1');
    const after = await t.request('GET', '/x/i/fake/external/tg_1/messages');
    expect(after.status).toBe(200);
    expect(after.json.messages).toEqual([]);
    // already gone: the goal is reached
    expect((await t.request('DELETE', '/x/i/fake/external/inconnue_1')).status).toBe(200);

    // an Intendia session goes through the deletion with undo
    const own = await t.request('DELETE', `/x/i/fake/external/${s.id}`);
    expect(own.status).toBe(409);
    expect(own.json.code).toBe('owned');
    expect((await t.request('GET', base)).status).toBe(200);
    // …and so does what continues it after compression
    await seed({ id: 'suite_1', source: 'api_server', parent_session_id: s.id });
    await seed({ id: 'suite_2', source: 'api_server', lineage_root: s.id });
    for (const id of ['suite_1', 'suite_2']) {
      const r = await t.request('DELETE', `/x/i/fake/external/${id}`);
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('owned');
    }
    await seed({ id: 'enfant_1', source: 'subagent', internal_child: true });
    const child = await t.request('DELETE', '/x/i/fake/external/enfant_1');
    expect(child.status).toBe(409);
    expect(child.json.code).toBe('child');

    // a turn running: Hermes refuses, Intendia says why; another 409 stays a Hermes error
    await seed({ id: 'tg_busy', busy: 'session_active_turn' });
    const busy = await t.request('DELETE', '/x/i/fake/external/tg_busy');
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe('run_active');
    await seed({ id: 'tg_other', busy: 'autre_code' });
    expect((await t.request('DELETE', '/x/i/fake/external/tg_other')).status).toBe(502);
    expect((await t.request('GET', '/x/i/fake/other-sessions')).json.sessions.map((x: any) => x.id)).toEqual(expect.arrayContaining(['tg_busy', 'tg_other', 'suite_1']));

    expect((await t.request('DELETE', '/x/i/fake/external/mauvais%20id')).status).toBe(400);
    expect((await t.request('DELETE', '/x/i/fake/external/tg_busy?profile=inconnu')).status).toBe(400);
  });

  it('reads GET /api/sessions/{id} wrapped or flat', async () => {
    const { SessionGetSchema } = await import('../src/connectors/sessions/index.js');
    expect(SessionGetSchema.parse({ session: { id: 'a', title: 't' } })).toMatchObject({ id: 'a', title: 't' });
    expect(SessionGetSchema.parse({ id: 'b' })).toMatchObject({ id: 'b' });
  });
});
