import { workspaces as workspacesTable } from '../src/db/schema.js';
import { describe, expect, it } from 'vitest';
import { lineTitle, mergeRecent } from '../src/sessions/recent.js';
import { testApp, waitRun } from './helpers.js';

const own = (id: string, at: number, extra: Record<string, unknown> = {}) => ({
  id, instanceId: 'a', workspace: 'dev', title: null, archived: false, lastRunId: null, lastActiveAt: at, createdAt: at,
  model: null, modelProvider: null, effort: null, pinned: false, copiedFrom: null, workspaceName: 'Dev', profile: 'default', ...extra,
});

describe('mergeRecent', () => {
  it('mixes both sources by activity (Hermes seconds, Intendia ms), drops duplicates, cuts at the limit', () => {
    const list = mergeRecent(
      [own('iw-1', 2_000_000), own('iw-2', 500_000, { title: 'Rapport' })],
      [
        { instanceId: 'a', label: 'Hermes 1', profile: 'default', sessions: [
          { id: 'tg', source: 'telegram', title: null, preview: 'x'.repeat(100), started_at: 1_000, last_active: 1_500, message_count: 4 },
          { id: 'cr', source: 'cron', title: 'Basket', started_at: 100, message_count: null },
        ] },
        { instanceId: 'a', label: 'Hermes 1', profile: 'ops', sessions: [{ id: 'tg', source: 'telegram', started_at: 1_000 }] },
      ],
      10,
    );
    expect(list.map((s) => s.id)).toEqual(['iw-1', 'tg', 'iw-2', 'cr']);
    expect(list[0]).toMatchObject({ kind: 'intendia', source: 'intendia', title: 'Nouvelle session', sub: 'Dev', workspace: 'dev' });
    expect(list[1]).toMatchObject({ kind: 'hermes', source: 'telegram', sub: 'Hermes 1 · 4 messages', at: 1_500_000, workspace: null });
    expect(list[1]!.title).toHaveLength(80);
    expect(list[3]).toMatchObject({ title: 'Basket', sub: 'Hermes 1', at: 100_000 });
    expect(mergeRecent([own('iw-1', 2)], [{ instanceId: 'a', label: 'H', profile: 'default', sessions: [{ id: 'x' }] }], 1)).toHaveLength(1);
  });

  it('falls back on the preview, then on a fixed title; a null source stays null', () => {
    expect(lineTitle(null, '  Bonjour ')).toBe('Bonjour');
    expect(lineTitle('', null)).toBe('Session sans titre');
    const [s] = mergeRecent([], [{ instanceId: 'a', label: 'H', profile: 'default', sessions: [{ id: 'x', message_count: 1 }] }], 5);
    expect(s).toMatchObject({ source: null, sub: 'H · 1 message', at: 0 });
  });
});

describe('GET /x/i/fake/sessions/recent', () => {
  it('lists Intendia sessions and sessions born elsewhere, without archived ones nor duplicates', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const b = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const run = (await t.request('POST', `/x/sessions/fake/${a.id}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, `/x/sessions/fake/${a.id}`, run);
    await t.request('PATCH', `/x/sessions/fake/${b.id}`, { archived: true });
    t.fake.sim.extraSessions.set('tg-1', { id: 'tg-1', source: 'telegram', title: 'Depuis Telegram', started_at: 1, messages: [] });
    const res = await t.request('GET', '/x/i/fake/sessions/recent');
    expect(res.status).toBe(200);
    const ids = res.json.sessions.map((s: any) => s.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(ids.filter((id: string) => id === a.id)).toHaveLength(1);
    expect(res.json.sessions.find((s: any) => s.id === 'tg-1')).toMatchObject({ kind: 'hermes', source: 'telegram', title: 'Depuis Telegram', at: 1000 });
    expect(res.json.errors).toEqual([]);
  });

  it('reads further Hermes pages when the first ones are Intendia sessions', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    for (const input of ['Un', 'Deux']) {
      const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
      const run = (await t.request('POST', `/x/sessions/fake/${s.id}/runs`, { input })).json.runId;
      await waitRun(t, `/x/sessions/fake/${s.id}`, run);
      await t.request('PATCH', `/x/sessions/fake/${s.id}`, { archived: true });
    }
    t.fake.sim.extraSessions.set('tg-1', { id: 'tg-1', source: 'telegram', title: 'Plus ancienne', started_at: 1, messages: [] });
    const res = (await t.request('GET', '/x/i/fake/sessions/recent?limit=2')).json;
    expect(res.sessions.map((s: any) => s.id)).toContain('tg-1');
    const offsets = t.fake.requests.filter((r) => r.via === 'api' && r.path === '/api/sessions').map((r) => r.query?.offset);
    expect(offsets.filter((o) => o !== undefined)).toEqual(['0', '2']);
  });

  it('bounds the limit and reports an instance that fails with its label', async () => {
    const t = await testApp({ breaks: { 'api GET /api/sessions': { status: 500 } } });
    expect((await t.request('GET', '/x/i/fake/sessions/recent?limit=0')).status).toBe(400);
    expect((await t.request('GET', '/x/i/fake/sessions/recent?limit=201')).status).toBe(400);
    expect((await t.request('GET', '/x/i/fake/sessions/recent?source=web')).status).toBe(400);
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces/dev/sessions');
    const res = (await t.request('GET', '/x/i/fake/sessions/recent?limit=5')).json;
    expect(res.sessions).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].instance).toBe(t.inst.label);
  });
});

const extra = (t: Awaited<ReturnType<typeof testApp>>, id: string, source: string, title: string | null, messages: string[] = []) =>
  t.fake.sim.extraSessions.set(id, { id, source, title, started_at: 1_000, messages: messages.map((content) => ({ role: 'user', content })) });

describe('GET /x/i/fake/sessions/recent?source', () => {
  it('telegram: Hermes only, the source sent to Hermes; intendia: no Hermes call; 200 accepted', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces/dev/sessions');
    extra(t, 'tg-1', 'telegram', 'Télégramme');
    extra(t, 'cr-1', 'cron', 'Basket');
    const tg = (await t.request('GET', '/x/i/fake/sessions/recent?source=telegram&limit=200')).json;
    expect(tg.sessions.map((s: any) => s.id)).toEqual(['tg-1']);
    const call = t.fake.requests.filter((r) => r.via === 'api' && r.path === '/api/sessions').at(-1);
    expect(call?.query).toMatchObject({ source: 'telegram', limit: '200' });
    const before = t.fake.requests.filter((r) => r.path === '/api/sessions').length;
    const own = (await t.request('GET', '/x/i/fake/sessions/recent?source=intendia')).json;
    expect(own.sessions.every((s: any) => s.kind === 'intendia')).toBe(true);
    expect(own.sessions).toHaveLength(1);
    expect(t.fake.requests.filter((r) => r.path === '/api/sessions').length).toBe(before);
  });
});

describe('GET /x/i/fake/sessions/search', () => {
  async function setup(opts: Parameters<typeof testApp>[0] = {}) {
    const t = await testApp(opts);
    const res = await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    // without dashboard there are no workspace files: the row alone (a workspace made before the dashboard went away)
    if (res.status !== 201) {
      t.db.insert(workspacesTable).values({ slug: 'dev', name: 'Dev', instanceId: 'fake', profile: null, model: null, modelProvider: null, effort: null, createdAt: Date.now() }).run();
    }
    return t;
  }

  it('finds an Intendia title, a Hermes message with its snippet; an owned hit is one Intendia line with the snippet', async () => {
    const t = await setup();
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'Budget électricité' });
    const b = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const run = (await t.request('POST', `/x/sessions/fake/${b.id}/runs`, { input: 'Parlons du budget annuel' })).json.runId;
    await waitRun(t, `/x/sessions/fake/${b.id}`, run);
    extra(t, 'tg-1', 'telegram', null, ['Rappel : le budget du club']);
    const res = await t.request('GET', '/x/i/fake/sessions/search?q=budget');
    expect(res.status).toBe(200);
    expect(res.json.partial).toEqual([]);
    const byId = new Map(res.json.sessions.map((s: any) => [s.id, s]));
    expect(byId.get(a.id)).toMatchObject({ kind: 'intendia', title: 'Budget électricité', snippet: null });
    expect(byId.get(b.id)).toMatchObject({ kind: 'intendia', workspace: 'dev' });
    expect((byId.get(b.id) as any).snippet).toContain('>>>budget<<<');
    expect(byId.get('tg-1')).toMatchObject({ kind: 'hermes', source: 'telegram', title: 'Rappel : le budget du club' });
    expect((byId.get('tg-1') as any).snippet).toContain('>>>budget<<<');
    expect(res.json.sessions.filter((s: any) => s.id === b.id)).toHaveLength(1);
  });

  it('source=intendia ignores Hermes sessions not owned; source=telegram skips Intendia titles and is sent to Hermes', async () => {
    const t = await setup();
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'Budget' });
    extra(t, 'tg-1', 'telegram', 'Budget Telegram');
    const own = (await t.request('GET', '/x/i/fake/sessions/search?q=budget&source=intendia')).json;
    expect(own.sessions.map((s: any) => s.id)).toEqual([a.id]);
    const tg = (await t.request('GET', '/x/i/fake/sessions/search?q=budget&source=telegram')).json;
    expect(tg.sessions.map((s: any) => s.id)).toEqual(['tg-1']);
    const call = t.fake.requests.filter((r) => r.via === 'dash' && r.path === '/api/sessions/search').at(-1);
    expect(call?.query).toMatchObject({ q: 'budget', source: 'telegram', limit: '30' });
  });

  it('without dashboard or on a Hermes 500: the instance is in partial, titles still found', async () => {
    for (const opts of [{ instance: { dashboard: undefined, dashboardToken: undefined } }, {}]) {
      const t = await setup(opts);
      const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
      await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'panne-recherche du jour' });
      const res = (await t.request('GET', '/x/i/fake/sessions/search?q=panne-recherche')).json;
      expect(res.partial).toEqual([t.inst.label]);
      expect(res.errors).toEqual([]);
      expect(res.sessions.map((s: any) => s.id)).toEqual([a.id]);
    }
  });

  it('title search folds case beyond ASCII (É matches é)', async () => {
    const t = await setup();
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'Électricité du chalet' });
    const res = (await t.request('GET', `/x/i/fake/sessions/search?q=${encodeURIComponent('électricité')}&source=intendia`)).json;
    expect(res.sessions.map((s: any) => s.id)).toEqual([a.id]);
  });

  it('a network-level failure is an error line; q is bounded; % is searched literally', async () => {
    const t = await setup({ breaks: { 'dash GET /api/sessions/search': { status: 401 } } });
    expect((await t.request('GET', '/x/i/fake/sessions/search?q=a')).status).toBe(400);
    expect((await t.request('GET', `/x/i/fake/sessions/search?q=${'x'.repeat(101)}`)).status).toBe(400);
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'Hausse de 10%' });
    const b = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${b.id}`, { title: 'Hausse de 105' });
    const res = (await t.request('GET', `/x/i/fake/sessions/search?q=${encodeURIComponent('10%')}`)).json;
    expect(res.sessions.map((s: any) => s.id)).toEqual([a.id]);
    expect(res.errors).toHaveLength(1);
  });
});

describe('sessions per instance', () => {
  it('keeps only the instance\'s Intendia sessions, filtered before the limit; unknown instance → 404', async () => {
    const t = await testApp({ extra: [{ id: 'b', label: 'Bureau' }] });
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces', { slug: 'bur', name: 'Bur', instanceId: 'b' });
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'Budget maison' });
    await new Promise((r) => setTimeout(r, 5));
    const b = (await t.request('POST', '/x/workspaces/bur/sessions')).json.session;
    await t.request('PATCH', `/x/sessions/b/${b.id}`, { title: 'Budget bureau' });

    const onA = (await t.request('GET', '/x/i/fake/sessions/recent?limit=1&source=intendia')).json.sessions;
    expect(onA.map((s: { id: string }) => s.id)).toEqual([a.id]);
    const onB = (await t.request('GET', '/x/i/b/sessions/recent?limit=1&source=intendia')).json.sessions;
    expect(onB.map((s: { id: string }) => s.id)).toEqual([b.id]);
    const found = (await t.request('GET', '/x/i/fake/sessions/search?q=budget&source=intendia')).json.sessions;
    expect(found.map((s: { id: string }) => s.id)).toEqual([a.id]);

    expect((await t.request('GET', '/x/i/inconnue/sessions/recent')).status).toBe(404);
    expect((await t.request('GET', '/x/i/inconnue/sessions/search?q=budget')).status).toBe(404);
    expect((await t.request('GET', '/x/sessions/recent')).status).toBe(404);
  });
});
