import { describe, expect, it } from 'vitest';
import { lineTitle, mergeRecent } from '../src/sessions/recent.js';
import { testApp, waitRun } from './helpers.js';

const own = (id: string, at: number, extra: Record<string, unknown> = {}) => ({
  id, instanceId: 'a', workspace: 'dev', title: null, archived: false, lastRunId: null, lastActiveAt: at, createdAt: at,
  model: null, effort: null, workspaceName: 'Dev', profile: 'default', ...extra,
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

describe('GET /x/sessions/recent', () => {
  it('lists Intendia sessions and sessions born elsewhere, without archived ones nor duplicates', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    const a = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const b = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const run = (await t.request('POST', `/x/sessions/fake/${a.id}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, `/x/sessions/fake/${a.id}`, run);
    await t.request('PATCH', `/x/sessions/fake/${b.id}`, { archived: true });
    t.fake.sim.extraSessions.set('tg-1', { id: 'tg-1', source: 'telegram', title: 'Depuis Telegram', started_at: 1 });
    const res = await t.request('GET', '/x/sessions/recent');
    expect(res.status).toBe(200);
    const ids = res.json.sessions.map((s: any) => s.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(ids.filter((id: string) => id === a.id)).toHaveLength(1);
    expect(res.json.sessions.find((s: any) => s.id === 'tg-1')).toMatchObject({ kind: 'hermes', source: 'telegram', title: 'Depuis Telegram', at: 1000 });
    expect(res.json.errors).toEqual([]);
  });

  it('bounds the limit and reports an instance that fails with its label', async () => {
    const t = await testApp({ breaks: { 'api GET /api/sessions': { status: 500 } } });
    expect((await t.request('GET', '/x/sessions/recent?limit=0')).status).toBe(400);
    expect((await t.request('GET', '/x/sessions/recent?limit=51')).status).toBe(400);
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    await t.request('POST', '/x/workspaces/dev/sessions');
    const res = (await t.request('GET', '/x/sessions/recent?limit=5')).json;
    expect(res.sessions).toHaveLength(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].instance).toBe(t.inst.label);
  });
});
