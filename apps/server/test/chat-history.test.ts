import { describe, expect, it, vi } from 'vitest';
import { exportMessages, toMarkdown } from '../src/sessions/export.js';
import { testApp, waitRun } from './helpers.js';

async function session(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}

/** A session of 1 200 messages at the fake (`message 1` … `message 1200`). */
async function long() {
  const x = await session();
  await x.t.fake.api.request(`/_fake/sessions/${x.s.id}/bulk`, { method: 'POST', body: JSON.stringify({ count: 1200 }), headers: { 'Content-Type': 'application/json' } });
  return x;
}

const messageReads = (t: Awaited<ReturnType<typeof testApp>>) => t.fake.requests.filter((r) => r.method === 'GET' && r.path.endsWith('/messages')).length;
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('long sessions', () => {
  it('the thread reads pages of 500 from the end until all 1 200 messages are read', async () => {
    const { t, base } = await long();
    const first = (await t.request('GET', `${base}/messages`)).json;
    expect(first.messages).toHaveLength(500);
    expect(first.hasMore).toBe(true);
    expect(first.messages.at(-1).content).toBe('message 1200');
    expect(first.runs).toEqual([]);
    const second = (await t.request('GET', `${base}/messages?offset=500`)).json;
    expect(second.messages).toHaveLength(500);
    expect(second).not.toHaveProperty('runs');
    const third = (await t.request('GET', `${base}/messages?offset=1000`)).json;
    expect(third.messages).toHaveLength(200);
    expect(third.hasMore).toBe(false);
    expect(third.messages[0].content).toBe('message 1');
    const ids = new Set([...first.messages, ...second.messages, ...third.messages].map((m: { id: number }) => m.id));
    expect(ids.size).toBe(1200);
    expect((await t.request('GET', `${base}/messages?offset=-1`)).status).toBe(400);
    expect((await t.request('GET', `${base}/messages?offset=abc`)).status).toBe(400);
  });

  it('a page of hidden rows only still moves the cursor: nextOffset counts raw rows, the older messages are reached', async () => {
    const { t, s, base } = await session();
    const bulk = (body: object) => t.fake.api.request(`/_fake/sessions/${s.id}/bulk`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    await bulk({ count: 300 }); // older messages
    await bulk({ count: 500, hidden: true });
    await bulk({ count: 500 }); // 500 recent messages
    const first = (await t.request('GET', `${base}/messages`)).json;
    expect(first.messages).toHaveLength(500);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(500);
    const second = (await t.request('GET', `${base}/messages?offset=${first.nextOffset}`)).json;
    expect(second.messages).toHaveLength(0);
    expect(second.hasMore).toBe(true);
    expect(second.nextOffset).toBe(1000);
    const third = (await t.request('GET', `${base}/messages?offset=${second.nextOffset}`)).json;
    expect(third.messages).toHaveLength(300);
    expect(third.messages[0].content).toBe('message 1');
    expect(third.hasMore).toBe(false);
    expect(third.nextOffset).toBe(1301); // the session_meta row counts too
  });

  it('a full page with one malformed row: still a full page (hasMore, nextOffset count raw rows)', async () => {
    const { t, s, base } = await session();
    const rows: unknown[] = Array.from({ length: 499 }, (_, i) => ({ id: i + 1, role: 'user', content: `message ${i + 1}`, timestamp: 1_700_000_000 + i }));
    rows.splice(250, 0, { id: 'pas-un-nombre', role: 'user', content: 'mal formé' });
    await t.fake.api.request('/_fake/breaks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `api GET /api/sessions/${s.id}/messages`, body: { data: rows, session_id: s.id } }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = (await t.request('GET', `${base}/messages`)).json;
    warn.mockRestore();
    expect(first.messages).toHaveLength(499);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(500);
  });

  it('the markdown export has every message, oldest first', async () => {
    const { t, base } = await long();
    const md = await (await t.raw('GET', `${base}/export?format=md`)).text();
    const at = (n: number) => md.search(new RegExp(`^message ${n}$`, 'm'));
    expect(at(1)).toBeGreaterThan(0);
    expect(at(1200)).toBeGreaterThan(at(600));
    expect(at(600)).toBeGreaterThan(at(1));
    expect(md).not.toContain('Export limité');
    expect(t.fake.requests.filter((r) => r.path.endsWith('/messages')).every((r) => r.query.order === 'oldest')).toBe(true);
  });

  it('an export stops at its page cap and says so in its heading', async () => {
    const { t, s } = await long();
    const out = await exportMessages(t.compat, t.services.workspaces.getSession('fake', s.id), 2);
    expect(out.messages).toHaveLength(999); // 1 000 rows, the first one is session_meta
    expect(out.capped).toBe(true);
    const md = toMarkdown({ title: 'T', startedAt: null, agent: 'Hermes', capped: out.messages.length }, out.messages);
    expect(md.split('\n').slice(0, 4).join('\n')).toContain('Export limité aux 999 premiers messages');
  });
});

describe('run-stats', () => {
  it('re-costs the last run without reading any message', async () => {
    const { t, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    await until(() => t.fake.sim.runs.get(run)!.status === 'completed');
    const before = messageReads(t);
    const res = await t.request('GET', `${base}/run-stats`);
    expect(res.status).toBe(200);
    expect(res.json.runs).toHaveLength(1);
    expect(res.json.runs[0]).toMatchObject({ runId: run, status: 'completed', costUsd: 0.0123 });
    expect(messageReads(t)).toBe(before);
  });

  it('a compression during the run gives an unknown cost, never the figure before it', async () => {
    const { t, s, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await until(() => t.fake.sim.runs.get(run)!.status === 'waiting_for_approval');
    await t.fake.api.request(`/_fake/sessions/${s.id}/compress`, { method: 'POST' });
    await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'once' });
    await until(() => t.fake.sim.runs.get(run)!.status === 'completed');
    const res = await t.request('GET', `${base}/run-stats`);
    expect(res.json.runs[0]).toMatchObject({ runId: run, status: 'completed', costUsd: null });
  });

  it('a session Hermes does not have (404) costs 0', async () => {
    const { t, s, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, base, run);
    t.fake.sim.messages.delete(s.id);
    t.fake.sim.costs.delete(s.id);
    const res = await t.request('GET', `${base}/run-stats`);
    expect(res.json.runs[0]).toMatchObject({ runId: run, costUsd: 0 });
  });
});
