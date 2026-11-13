import { describe, expect, it } from 'vitest';
import { RunBusyError } from '../src/chat/start-run.js';
import { DelegationWatcher, MAX_WAKES, summarize, WAKE_TEXT, wakeDecision, WakeStore } from '../src/chat/wake.js';
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
    expect(summarize(d, null, 100)).toEqual({ openTasks: 0, since: null, capped: false, wakePending: true });
    expect(summarize(d, null, 4 + 601)).toBeNull();
    const row = { instanceId: 'i', sessionId: 's', deliveryKey: 'm:4', state: 'starting', runId: null, chain: 1, createdAt: 0 };
    expect(summarize(d, row, 100)?.wakePending).toBe(true);
    expect(summarize(d, { ...row, state: 'started', runId: 'r' }, 100)).toBeNull();
    expect(summarize(d, { ...row, state: 'abandoned' }, 100)).toBeNull();
    expect(summarize(wakeDecision([...base, dl(4)], 100, MAX_WAKES), null, 100)).toEqual({ openTasks: 0, since: null, capped: true, wakePending: false });
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
