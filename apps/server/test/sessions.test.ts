import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp, waitRun } from './helpers.js';

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
    expect(existsSync(join(t.mount, 'dev', 'sessions', s.id))).toBe(true);
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
    const patch = t.fake.requests.find((r) => r.method === 'PATCH' && r.path === `/api/sessions/${s.id}`);
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

    expect((await t.request('DELETE', base)).status).toBe(200);
    expect(t.fake.requests.some((r) => r.method === 'DELETE' && r.path === `/api/sessions/${first.id}`)).toBe(true);
    expect((await t.request('GET', base)).status).toBe(404);
    expect(existsSync(join(t.mount, 'dev', 'sessions', first.id))).toBe(true);
    // never sent to Hermes: Hermes answers 404, the row goes anyway
    expect((await t.request('DELETE', `/x/sessions/fake/${second.id}`)).status).toBe(200);
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

  it('reads GET /api/sessions/{id} wrapped or flat', async () => {
    const { SessionGetSchema } = await import('../src/connectors/sessions/index.js');
    expect(SessionGetSchema.parse({ session: { id: 'a', title: 't' } })).toMatchObject({ id: 'a', title: 't' });
    expect(SessionGetSchema.parse({ id: 'b' })).toMatchObject({ id: 'b' });
  });
});
