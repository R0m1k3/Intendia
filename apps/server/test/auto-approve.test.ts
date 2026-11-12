import { describe, expect, it } from 'vitest';
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
});
