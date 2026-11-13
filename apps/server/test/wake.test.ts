import { describe, expect, it } from 'vitest';
import { RunBusyError } from '../src/chat/start-run.js';
import { DelegationWatcher, MAX_WAKES, summarize, unitsGone, WAKE_TEXT, WAKE_TEXT_PARTIAL, wakeDecision, WakeStore } from '../src/chat/wake.js';
import type { SubagentChild } from '../src/chat/subagents.js';
import type { ChatMessage } from '../src/chat/history.js';
import type { DelegationInfo, TicketInfo } from '../src/chat/delegation.js';
import { testApp, waitRun } from './helpers.js';

// ---- pure decision

const msg = (id: number, role: string, content = 'x', extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, content, toolName: null, toolCalls: [], timestamp: id, ...extra });
const tk = (id: number, t: Partial<TicketInfo>) => msg(id, 'tool', '{}', { ticket: { delegationId: 'd1', goals: ['a', 'b'], refused: [], units: [], ...t } });
const info = (p: Partial<DelegationInfo>): DelegationInfo => ({
  id: 'd1', tasks: null, completed: null, failed: null, durationSeconds: null, failedTask: null, taskStatuses: [], allFailed: false, ...p,
});
const dl = (id: number, p: Partial<DelegationInfo> = {}) => msg(id, 'delegation', 'texte', { delegation: info(p) });
const NOW = 1_000;

describe('wakeDecision', () => {
  const base = [msg(1, 'user', 'fond'), tk(2, {}), msg(3, 'assistant', 'Je vous préviens.')];

  it('a delivery alone in the queue: wake, keyed on its message', () => {
    const d = wakeDecision([...base, dl(4)], NOW, 0);
    expect(d).toMatchObject({ kind: 'wake', key: 'm:4', openTasks: 0, deliveredAt: 4 });
  });

  it('the user wrote after the delivery: quiet', () => {
    expect(wakeDecision([...base, dl(4), msg(5, 'user', 'merci'), msg(6, 'assistant', 'ok')], NOW, 0).kind).toBe('quiet');
  });

  it('one unit of two delivered: wait, open tasks of the other unit', () => {
    const units = [{ id: 'd1-1', tasks: [0] }, { id: 'd1-2', tasks: [1, 2] }];
    const d = wakeDecision([msg(1, 'user', 'fond'), tk(2, { goals: ['a', 'b', 'c'], refused: [2], units }), msg(3, 'assistant', 'ok'), dl(4, { id: 'd1-1' })], NOW, 0);
    expect(d).toMatchObject({ kind: 'wait', openTasks: 1, since: 2 });
  });

  it('a unit left open for more than 24 h is not waited for', () => {
    const units = [{ id: 'd1-1', tasks: [0] }, { id: 'd1-2', tasks: [1] }];
    const d = wakeDecision([msg(1, 'user', 'fond'), tk(2, { units }), msg(3, 'assistant', 'ok'), dl(90_000, { id: 'd1-1' })], 90_010, 0);
    expect(d).toMatchObject({ kind: 'wake', openTasks: 0 });
  });

  it('an early failure notice alone: wait', () => {
    expect(wakeDecision([...base, dl(4, { failedTask: 1 })], NOW, 0)).toMatchObject({ kind: 'wait', openTasks: 2 });
  });

  it(`${MAX_WAKES} wakes in a row: capped; one less: wake`, () => {
    expect(wakeDecision([...base, dl(4)], NOW, MAX_WAKES).kind).toBe('capped');
    expect(wakeDecision([...base, dl(4)], NOW, MAX_WAKES - 1).kind).toBe('wake');
  });

  it('an empty message after the delivery is skipped; refused tasks are not open', () => {
    expect(wakeDecision([...base, dl(4), msg(5, 'assistant', '  ')], NOW, 0).kind).toBe('wake');
    expect(wakeDecision([msg(1, 'user', 'fond'), tk(2, { goals: ['a', 'b', 'c'], refused: [2] })], NOW, 0).openTasks).toBe(2);
  });

  it('nothing delegated: quiet, no summary', () => {
    const d = wakeDecision([msg(1, 'user', 'Bonjour'), msg(2, 'assistant', 'Bonjour')], NOW, 0);
    expect(d.kind).toBe('quiet');
    expect(summarize(d, null, NOW)).toBeNull();
  });

  it('summary: pending while the delivery is recent and not answered, or the start goes on', () => {
    const d = wakeDecision([...base, dl(4)], 100, 0);
    expect(summarize(d, null, 100)).toEqual({ openTasks: 0, since: null, capped: false, wakePending: true, lostRecent: false });
    expect(summarize(d, null, 4 + 601)).toBeNull();
    const row = { instanceId: 'i', sessionId: 's', deliveryKey: 'm:4', state: 'starting', runId: null, chain: 1, createdAt: 0 };
    expect(summarize(d, row, 100)?.wakePending).toBe(true);
    expect(summarize(d, { ...row, state: 'started', runId: 'r' }, 100)).toBeNull();
    expect(summarize(d, { ...row, state: 'abandoned' }, 100)).toBeNull();
    expect(summarize(wakeDecision([...base, dl(4)], 100, MAX_WAKES), null, 100)).toEqual({ openTasks: 0, since: null, capped: true, wakePending: false, lostRecent: false });
  });
});

describe('lost units', () => {
  const units = [{ id: 'd1-1', tasks: [0] }, { id: 'd1-2', tasks: [1] }];
  const two = [msg(1, 'user', 'fond'), tk(2, { units }), msg(3, 'assistant', 'ok')];

  it('a lost unit alone: quiet, not waited for, but recent (re-read)', () => {
    const d = wakeDecision([msg(1, 'user', 'fond'), tk(2, {}), msg(3, 'assistant', 'ok')], NOW, 0, new Set(['d1']));
    expect(d).toMatchObject({ kind: 'quiet', openTasks: 0, openUnits: [], lostRecent: true });
    expect(summarize(d, null, NOW)).toEqual({ openTasks: 0, since: null, capped: false, wakePending: false, lostRecent: true });
    expect(wakeDecision([msg(1, 'user', 'fond'), tk(2, {})], 90_000, 0, new Set(['d1'])).lostRecent).toBe(false);
  });

  it('one unit delivered, the other lost: wake, with the partial text flag; an old lost unit does not count', () => {
    const d = wakeDecision([...two, dl(4, { id: 'd1-1' })], NOW, 0, new Set(['d1-2']));
    expect(d).toMatchObject({ kind: 'wake', key: 'm:4', lostUsed: true });
    expect(wakeDecision([...two, dl(4, { id: 'd1-1' })], NOW, 0, new Set(['d1-2']), 3_000).lostUsed).toBe(false);
    expect(wakeDecision([...two, dl(4, { id: 'd1-1' })], NOW, 0).kind).toBe('wait');
  });

  it('a lost unit delivered later: plain wake', () => {
    const d = wakeDecision([...two, dl(4, { id: 'd1-1' }), dl(5, { id: 'd1-2' })], NOW, 0, new Set(['d1-2']));
    expect(d).toMatchObject({ kind: 'wake', lostUsed: false, openUnits: [] });
  });

  const child = (p: Partial<SubagentChild>): SubagentChild => ({
    id: 'c', goal: 'g', cut: false, startedAt: 100, endedAt: null, endReason: null, lastActive: 100, toolCalls: 0, apiCalls: 0, ...p,
  });

  it('unitsGone: children alive, ended recently, ended long ago, silent, absent, older than the ticket', () => {
    expect(unitsGone([child({ lastActive: 990 })], 100, 100, 1_000, 300, 900)).toBe(false);
    expect(unitsGone([child({ endedAt: 800, lastActive: 800 })], 100, 100, 1_000, 300, 900)).toBe(false);
    expect(unitsGone([child({ endedAt: 600, lastActive: 600 })], 100, 100, 1_000, 300, 900)).toBe(true);
    expect(unitsGone([child({ lastActive: 50 + 100 })], 100, 100, 1_100, 300, 900)).toBe(true);
    expect(unitsGone([child({ lastActive: 500 })], 100, 100, 1_000, 300, 900)).toBe(false);
    expect(unitsGone([], 100, 100, 1_000, 300, 900)).toBe(true);
    expect(unitsGone([], 100, 900, 1_000, 300, 900)).toBe(false);
    // a child started long before the ticket belongs to an older delegation
    expect(unitsGone([child({ startedAt: -100, lastActive: 990 })], 100, 100, 1_000, 300, 900)).toBe(true);
    expect(unitsGone([child({ startedAt: null, lastActive: 990 })], 100, 100, 1_000, 300, 900)).toBe(false);
  });
});

// ---- store

describe('WakeStore', () => {
  it('prevChain: rank of the last started wake while its run is the last one; cleanup', async () => {
    const t = await testApp();
    const w = new WakeStore(t.db);
    expect(w.reserve('i', 's', 'm:1', 1, 1_000)).toBe(true);
    expect(w.reserve('i', 's', 'm:1', 1, 1_000)).toBe(false);
    expect(w.prevChain('i', 's', 'r1')).toBe(0);
    w.started('i', 's', 'm:1', 'r1');
    expect(w.prevChain('i', 's', 'r1')).toBe(1);
    expect(w.prevChain('i', 's', 'r-user')).toBe(0);
    w.reserve('i', 's', 'm:2', 2, 2_000);
    expect(w.prevChain('i', 's', 'r1')).toBe(1);
    w.abandon('i', 's', 'm:2');
    expect(w.get('i', 's', 'm:2')?.state).toBe('abandoned');
    w.reserve('i', 's', 'm:3', 2, Date.now());
    w.cleanup();
    expect(w.get('i', 's', 'm:3')?.state).toBe('abandoned');
    expect(w.get('i', 's', 'm:1')).toBeNull();
  });

  it('lost units: written once, read back, never taken for a wake', async () => {
    const t = await testApp();
    const w = new WakeStore(t.db);
    expect(w.lose('i', 's', ['d1', 'd2'])).toBe(2);
    expect(w.lose('i', 's', ['d1'])).toBe(0);
    expect(w.lostUnits('i', 's')).toEqual(new Set(['d1', 'd2']));
    expect(w.lostUnits('i', 'autre')).toEqual(new Set());
    expect(w.lastWakeAt('i', 's')).toBeNull();
    w.reserve('i', 's', 'm:1', 1, 5_000);
    w.started('i', 's', 'm:1', 'r1');
    expect(w.lastWakeAt('i', 's')).toBe(5_000);
    expect(w.prevChain('i', 's', 'r1')).toBe(1);
  });
});

// ---- against the fake

type T = Awaited<ReturnType<typeof testApp>>;

async function setup(bgDelayMs = 300) {
  const t = await testApp({ bgDelayMs });
  expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}
const lastRunId = async (t: T, base: string) => (await t.request('GET', base)).json.session.lastRunId as string;
const runs = (t: T) => t.fake.sim.runs.size;
const inputs = (t: T) => [...t.fake.sim.runs.values()].map((r) => r.input);
async function delivered(t: T, base: string) {
  for (let i = 0; i < 100; i++) {
    const res = (await t.request('GET', `${base}/messages`)).json;
    if (res.messages.some((m: { role: string }) => m.role === 'delegation')) return res;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('pas de livraison');
}

describe('DelegationWatcher (fake)', () => {
  it('« fond »: waits while the sub-agents work, wakes once after the delivery, never twice, not after a restart', async () => {
    const { t, s, base } = await setup(1_500);
    const lines: string[] = [];
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, { log: (l) => lines.push(l) });
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const key = `fake/${s.id}`;
    expect((await watcher.pass()).get(key)).toBe('wait');
    expect(watcher.working('fake')).toMatchObject([{ sessionId: s.id, tasks: 2, workspace: 'dev' }]);
    expect(watcher.working('other')).toEqual([]);
    const waiting = (await t.request('GET', `${base}/messages`)).json.subagents;
    expect(waiting).toMatchObject({ openTasks: 2, capped: false, wakePending: false });
    const res = await delivered(t, base);
    expect(res.subagents).toMatchObject({ openTasks: 0, wakePending: true });
    const before = runs(t);
    expect((await watcher.pass(Date.now() + 20_000)).get(key)).toBe('wake');
    expect(runs(t)).toBe(before + 1);
    expect(inputs(t).at(-1)).toBe(WAKE_TEXT);
    expect(watcher.working()).toEqual([]);
    expect(await waitRun(t, base, await lastRunId(t, base))).toBe('completed');
    expect((await t.request('GET', `${base}/messages`)).json.subagents).toBeNull();
    // next passes, and a new watcher on the same database: nothing more
    await watcher.pass(Date.now() + 40_000);
    await new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }).pass(Date.now() + 60_000);
    expect(runs(t)).toBe(before + 1);
    expect(lines.some((l) => l.includes('reprise') && l.includes('(1/5)'))).toBe(true);
  });

  it('a wake run that leaves no message (a failed run at Hermes 0.23): the same delivery is not answered again', async () => {
    const { t, s, base } = await setup();
    let calls = 0;
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, {
      log: () => {},
      start: async (deps, ctx) => {
        calls += 1;
        deps.workspaces.recordRun(ctx.instance.id, ctx.session.id, `run_fictif_${calls}`, WAKE_TEXT);
        return { runId: `run_fictif_${calls}` };
      },
    });
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    await delivered(t, base);
    expect((await watcher.pass()).get(`fake/${s.id}`)).toBe('wake');
    expect((await watcher.pass(Date.now() + 20_000)).get(`fake/${s.id}`)).toBe('quiet');
    await watcher.pass(Date.now() + 40_000);
    expect(calls).toBe(1);
    const row = t.services.wakes.get('fake', s.id, (await t.request('GET', `${base}/messages`)).json.messages.filter((m: { role: string }) => m.role === 'delegation').map((m: { id: number }) => `m:${m.id}`).at(-1));
    expect(row).toMatchObject({ state: 'started', runId: 'run_fictif_1', chain: 1 });
  });

  it('a send got there first (RunBusyError): the row is released; 3 other errors in a row: abandoned', async () => {
    const { t, s, base } = await setup();
    let mode: 'busy' | 'down' = 'busy';
    let calls = 0;
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, {
      log: () => {},
      start: async () => { calls += 1; throw mode === 'busy' ? new RunBusyError() : new Error('Hermes injoignable'); },
    });
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const msgs = (await delivered(t, base)).messages as { id: number; role: string }[];
    const dk = `m:${msgs.filter((m) => m.role === 'delegation').at(-1)!.id}`;
    const key = `fake/${s.id}`;
    expect((await watcher.pass()).get(key)).toBe('running');
    expect(t.services.wakes.get('fake', s.id, dk)).toBeNull();
    mode = 'down';
    let now = Date.now() + 20_000;
    for (let i = 0; i < 3; i++, now += 20_000) await watcher.pass(now);
    expect(calls).toBe(4);
    expect(t.services.wakes.get('fake', s.id, dk)?.state).toBe('abandoned');
    await watcher.pass(now + 20_000);
    expect(calls).toBe(4);
    expect((await t.request('GET', `${base}/messages`)).json.subagents).toBeNull();
  });

  it('the cap: after 5 wakes in a row, nothing more and the page is told', async () => {
    const { t, s, base } = await setup();
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const msgs = (await delivered(t, base)).messages as { id: number; role: string }[];
    // 5 earlier wakes, the last one being the session's last run
    const runId = await lastRunId(t, base);
    for (let i = 1; i <= MAX_WAKES; i++) {
      t.services.wakes.reserve('fake', s.id, `m:old${i}`, i, Date.now() - 10_000 + i);
      t.services.wakes.started('fake', s.id, `m:old${i}`, i === MAX_WAKES ? runId : `r${i}`);
    }
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, { log: () => {} });
    const before = runs(t);
    expect((await watcher.pass()).get(`fake/${s.id}`)).toBe('capped');
    expect(runs(t)).toBe(before);
    expect((await t.request('GET', `${base}/messages`)).json.subagents).toMatchObject({ capped: true, wakePending: false });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('a session waiting for sub-agents is read even behind 50 calm recent sessions', async () => {
    const { t, s, base } = await setup(60_000);
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, { log: () => {} });
    expect((await watcher.pass()).get(`fake/${s.id}`)).toBe('wait');
    for (let i = 0; i < 51; i++) {
      const o = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
      t.services.workspaces.recordRun('fake', o.id, `run_calme_${i}`, 'Bonjour');
    }
    const first = await watcher.pass(Date.now() + 20_000);
    expect(first.has(`fake/${s.id}`)).toBe(false);
    // the 51 calm ones were read once (quiet: their runs are unknown to Hermes), then the waiting one comes back
    const second = await watcher.pass(Date.now() + 40_000);
    expect(second.get(`fake/${s.id}`)).toBe('wait');
  });
});

describe('DelegationWatcher: lost deliveries (fake)', () => {
  it('« fond-oublie »: the children end, no delivery: given up after the grace, the page and the Centre are told', async () => {
    const { t, s, base } = await setup(300);
    const lines: string[] = [];
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, { log: (l) => lines.push(l), graceS: 5 });
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond-oublie' })).json.runId)).toBe('completed');
    await new Promise((r) => setTimeout(r, 600));
    const key = `fake/${s.id}`;
    const page = (await t.request('GET', `${base}/messages`)).json;
    expect(page.openUnits).toEqual(['deleg_fake1']);
    expect(page.subagents).toMatchObject({ openTasks: 2 });
    // too early for the grace: nothing checked
    expect((await watcher.pass()).get(key)).toBe('wait');
    await watcher.settled();
    expect(t.services.wakes.lostUnits('fake', s.id).size).toBe(0);
    expect((await watcher.pass(Date.now() + 20_000)).get(key)).toBe('wait');
    await watcher.settled();
    expect(t.services.wakes.lostUnits('fake', s.id)).toEqual(new Set(['deleg_fake1']));
    expect(lines.some((l) => l.includes('sans livraison'))).toBe(true);
    expect(watcher.working()).toEqual([]);
    expect((await watcher.pass(Date.now() + 25_000)).get(key)).toBe('quiet');
    expect(watcher.working()).toEqual([]);
    const after = (await t.request('GET', `${base}/messages`)).json;
    expect(after.openUnits).toEqual([]);
    expect(after.subagents).toMatchObject({ openTasks: 0, lostRecent: true });
    // not calm: read again a minute later
    expect((await watcher.pass(Date.now() + 90_000)).get(key)).toBe('quiet');
  });

  it('a child still working: nothing given up; a failed read of the children: retried later', async () => {
    const { t, s, base } = await setup(300);
    let calls = 0;
    let alive = true;
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, {
      log: () => {}, graceS: 5,
      children: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Hermes injoignable');
        const now = Date.now() / 1000 + 20;
        return [{ id: 'c', goal: 'g', cut: false, startedAt: now - 30, endedAt: alive ? null : now - 10, endReason: null, lastActive: now - 10, toolCalls: 1, apiCalls: 1 }];
      },
    });
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond-oublie' })).json.runId)).toBe('completed');
    const key = `fake/${s.id}`;
    await watcher.pass(Date.now() + 20_000); await watcher.settled();
    expect(calls).toBe(1);
    await watcher.pass(Date.now() + 20_500); await watcher.settled();
    expect(calls).toBe(1); // checkEvery not elapsed
    await watcher.pass(Date.now() + 40_000); await watcher.settled();
    expect(calls).toBe(2);
    expect(t.services.wakes.lostUnits('fake', s.id).size).toBe(0);
    alive = false;
    await watcher.pass(Date.now() + 60_000); await watcher.settled();
    expect(t.services.wakes.lostUnits('fake', s.id).size).toBe(1);
    expect((await watcher.pass(Date.now() + 80_000)).get(key)).toBe('quiet');
  });

  it('a delivery after the unit was given up still wakes the agent (plain text)', async () => {
    const { t, s, base } = await setup(1_500);
    const watcher = new DelegationWatcher({ ...t.services.runDeps, wakes: t.services.wakes }, { log: () => {}, graceS: 5, children: async () => [] });
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const key = `fake/${s.id}`;
    await watcher.pass(Date.now() + 20_000); await watcher.settled();
    expect(t.services.wakes.lostUnits('fake', s.id).size).toBe(1);
    expect((await watcher.pass(Date.now() + 21_000)).get(key)).toBe('quiet');
    await delivered(t, base);
    const before = runs(t);
    expect((await watcher.pass(Date.now() + 90_000)).get(key)).toBe('wake');
    expect(runs(t)).toBe(before + 1);
    expect(inputs(t).at(-1)).toBe(WAKE_TEXT);
    expect(WAKE_TEXT_PARTIAL).not.toMatch(/fond/i);
  });

  it('« Ne plus attendre »: the units shown open are given up at once; refused while a run goes on', async () => {
    const { t, s, base } = await setup(60_000);
    expect(await waitRun(t, base, (await t.request('POST', `${base}/runs`, { input: 'fond' })).json.runId)).toBe('completed');
    const watcher = t.services.watcher;
    await watcher.pass();
    expect(watcher.working('fake')).toHaveLength(1);
    const stop = await t.request('POST', `${base}/subagents/stop-waiting`, { units: ['deleg_fake1', 'inconnue'] });
    expect(stop.status).toBe(200);
    expect(stop.json).toEqual({ lost: 1 });
    expect(watcher.working('fake')).toEqual([]);
    const page = (await t.request('GET', `${base}/messages`)).json;
    expect(page.openUnits).toEqual([]);
    expect(page.subagents).toMatchObject({ openTasks: 0, lostRecent: true });
    expect((await t.request('POST', `${base}/subagents/stop-waiting`, { units: ['deleg_fake1'] })).json).toEqual({ lost: 0 });
    const run = (await t.request('POST', `${base}/runs`, { input: 'lent' })).json.runId;
    const busy = await t.request('POST', `${base}/subagents/stop-waiting`, { units: [] });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe('run_active');
    await t.request('POST', `${base}/runs/${run}/stop`);
    expect(s.id).toBeTruthy();
  });
});

describe('reserved starts', () => {
  it('the wake and relaunch starts are refused from the user, at send and at steer', async () => {
    const { t, base } = await setup();
    const sent = await t.request('POST', `${base}/runs`, { input: `${WAKE_TEXT} (moi)` });
    expect(sent.status).toBe(400);
    expect(sent.json.code).toBe('reserved_prefix');
    const runId = (await t.request('POST', `${base}/runs`, { input: 'lent' })).json.runId;
    for (const input of [WAKE_TEXT, '[Intendia] Relance automatique 1/5 : moi']) {
      const steer = await t.request('POST', `${base}/runs/${runId}/steer`, { input });
      expect(steer.status).toBe(400);
      expect(steer.json.code).toBe('reserved_prefix');
    }
  });
});
