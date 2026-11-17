import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoApprover } from '../src/sessions/auto-approve.js';
import { testApp, waitRun } from './helpers.js';

async function setup() {
  const t = await testApp();
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  const base = `/x/sessions/fake/${s.id}`;
  const lines: string[] = [];
  const approver = () => new AutoApprover(t.services.workspaces, t.services.activity, t.compat, (l) => lines.push(l));
  const waiting = async (runId: string, want = 'waiting_for_approval') => {
    for (let i = 0; i < 50; i++) {
      if ((await t.request('GET', `${base}/runs/${runId}`)).json.status === want) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`run ${runId} never ${want}`);
  };
  return { t, s, base, lines, approver, waiting };
}

describe('« Sans confirmation » (AutoApprover)', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('approves a waiting run of a session in « Sans confirmation », counts it on the run, logs it', async () => {
    const { t, base, lines, approver, waiting } = await setup();
    expect((await t.request('PATCH', base, { autoApprove: true })).json.session.autoApprove).toBe(true);
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await waiting(run);
    // a new AutoApprover on the same base (a server restart) picks it up
    expect(await approver().pass()).toEqual([`fake/${run}`]);
    expect(await waitRun(t, base, run)).toBe('completed');
    expect(lines.some((l) => l.includes('approuvé'))).toBe(true);
    const runs = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(runs.find((r: any) => r.runId === run).autoApproved).toBe(1);
  });

  it('never answers without the flag, nor a question of the agent, nor a deleted session', async () => {
    const { t, base, approver, waiting } = await setup();
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await waiting(run);
    expect(await approver().pass()).toEqual([]);
    await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'deny' });
    await waitRun(t, base, run);

    await t.request('PATCH', base, { autoApprove: true });
    const q = (await t.request('POST', `${base}/runs`, { input: 'question' })).json.runId;
    await new Promise((r) => setTimeout(r, 100));
    expect(await approver().pass()).toEqual([]);
    await t.request('POST', `${base}/runs/${q}/stop`, {});
    await waitRun(t, base, q);

    const again = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await waiting(again);
    await t.request('PATCH', base, { autoApprove: false });
    expect(await approver().pass()).toEqual([]);
    await t.request('PATCH', base, { autoApprove: true });
    t.services.workspaces.markDeleted('fake', [base.split('/').pop()!]);
    expect(await approver().pass()).toEqual([]);
  });
  it('two simultaneous passes: only one approves', async () => {
    const { t, base, approver, waiting } = await setup();
    await t.request('PATCH', base, { autoApprove: true });
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await waiting(run);
    const a = approver();
    expect(await Promise.all([a.pass(), a.pass()])).toEqual([[`fake/${run}`], []]);
    expect(await waitRun(t, base, run)).toBe('completed');
  });

  it('an error on one run does not stop the others', async () => {
    const { t, base, lines, approver, waiting } = await setup();
    const s2 = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const base2 = `/x/sessions/fake/${s2.id}`;
    await t.request('PATCH', base, { autoApprove: true });
    await t.request('PATCH', base2, { autoApprove: true });
    const r1 = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    const r2 = (await t.request('POST', `${base2}/runs`, { input: 'approval' })).json.runId;
    await waiting(r1);
    for (let i = 0; i < 50 && (await t.request('GET', `${base2}/runs/${r2}`)).json.status !== 'waiting_for_approval'; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    vi.spyOn(t.services.workspaces, 'addAutoApproved').mockImplementationOnce(() => { throw new Error('boom'); });
    const approved = await approver().pass();
    expect(approved).toHaveLength(1);
    const failed = [`fake/${r1}`, `fake/${r2}`].find((k) => !approved.includes(k))!;
    expect(lines.some((l) => l.includes('boom') && l.includes(failed))).toBe(true);
  });

  it('ignores a run older than the last run of its session', async () => {
    const { t, s, base, approver, waiting } = await setup();
    await t.request('PATCH', base, { autoApprove: true });
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await waiting(run);
    t.services.workspaces.recordRun('fake', s.id, 'run_newer', 'plus récent');
    expect(await approver().pass()).toEqual([]);
  });

  it('start() twice keeps one timer; stop() ends the passes', async () => {
    const { approver } = await setup();
    vi.useFakeTimers();
    const a = approver();
    const pass = vi.spyOn(a, 'pass').mockResolvedValue([]);
    const timer = (x: AutoApprover) => (x as unknown as { timer: unknown }).timer;
    a.start();
    const first = timer(a);
    a.start();
    expect(timer(a)).toBe(first);
    vi.advanceTimersByTime(2_000);
    expect(pass).toHaveBeenCalledTimes(1);
    a.stop();
    vi.advanceTimersByTime(10_000);
    expect(pass).toHaveBeenCalledTimes(1);
    expect(timer(a)).toBeNull();
  });
});
