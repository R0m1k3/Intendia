import { describe, expect, it } from 'vitest';
import { testApp, waitRun } from './helpers.js';

async function session() {
  const t = await testApp({ bgDelayMs: 60_000 });
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}

const child = (t: Awaited<ReturnType<typeof testApp>>, row: Record<string, unknown>) => t.fake.sim.children.set(String(row.id), {
  source: 'subagent', preview: '', started_at: 100, ended_at: null, end_reason: null, last_active: 100, message_count: 1,
  tool_call_count: 0, api_call_count: 1, title: null, parent_session_id: null, ...row,
} as never);

describe('GET /x/sessions/:inst/:id/subagents', () => {
  it('session without any message at Hermes: no children', async () => {
    const { t, base } = await session();
    const res = await t.request('GET', `${base}/subagents`);
    expect(res.status).toBe(200);
    expect(res.json.children).toEqual([]);
  });

  it('only the sub-agent sessions of this session (or its live continuation), sorted by start', async () => {
    const { t, s, base } = await session();
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId)).toBe('completed');
    t.fake.sim.liveAlias.set(s.id, 'continuation-1');
    child(t, { id: 'c2', parent_session_id: s.id, preview: 'Compter les rayons', started_at: 200, tool_call_count: 4, last_active: 260 });
    child(t, { id: 'c1', parent_session_id: s.id, preview: `${'x'.repeat(60)}...`, started_at: 150, ended_at: 300, end_reason: 'completed' });
    child(t, { id: 'c3', parent_session_id: 'continuation-1', preview: 'Après compression', started_at: 400 });
    child(t, { id: 'other', parent_session_id: 'another-session', preview: 'Ailleurs' });
    child(t, { id: 'orphan', parent_session_id: null, preview: 'Sans parent' });
    child(t, { id: 'branch', parent_session_id: s.id, source: 'api_server', preview: 'Branche' });
    child(t, { id: 'gw', parent_session_id: s.id, source: 'telegram', is_internal_child: true, preview: 'Sous la passerelle', started_at: 500 });
    const res = await t.request('GET', `${base}/subagents`);
    expect(res.status).toBe(200);
    expect(res.json.children.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2', 'c3', 'gw']);
    expect(res.json.children[0]).toEqual({
      id: 'c1', goal: 'x'.repeat(60), cut: true, startedAt: 150, endedAt: 300, endReason: 'completed', lastActive: 100, toolCalls: 0, apiCalls: 1,
    });
    expect(res.json.children[1]).toMatchObject({ goal: 'Compter les rayons', cut: false, toolCalls: 4, lastActive: 260, endedAt: null });
    const list = t.fake.requests.filter((r) => r.method === 'GET' && r.path === '/api/sessions').at(-1)!;
    expect(list.query).toMatchObject({ include_children: 'true', limit: '100' });
  });

  it('the "fond" scenario: two children moving, a delivery row with no display_metadata served', async () => {
    const { t, s, base } = await session();
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const kids = (await t.request('GET', `${base}/subagents`)).json.children;
    expect(kids.map((c: { goal: string }) => c.goal)).toEqual(['Relire les ventes', 'Compter les rayons']);
    const run = [...t.fake.sim.runs.values()].at(-1)!;
    expect(run.sessionId).toBe(s.id);
  });
});
