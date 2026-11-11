import { describe, expect, it } from 'vitest';
import { lastPendingApproval, pendingFromStatus } from '../src/agents/approvals.js';
import { controlBody } from '../src/routes/chat.js';

const f = (id: number, data: unknown) => ({ id: String(id), data });

describe('lastPendingApproval', () => {
  it('keeps the last request not yet answered', () => {
    const frames = [
      f(1, { event: 'run.started' }),
      f(2, { event: 'approval.request', request_id: 'r1', command: 'ls', choices: ['once', 'deny'] }),
      f(3, { event: 'approval.responded', request_id: 'r1' }),
      f(4, { event: 'approval.request', request_id: 'r2', command: 'rm x', description: 'Supprimer' }),
    ];
    expect(lastPendingApproval('run_1', frames)).toEqual({
      kind: 'approval', key: 'run_1:r2', requestId: 'r2', command: 'rm x', description: 'Supprimer', choices: ['once', 'deny'],
      question: null, multiSelect: false,
    });
  });

  it('nothing once answered, nothing without request; seq key without request_id', () => {
    expect(lastPendingApproval('run_1', [f(2, { event: 'approval.request', request_id: 'r1' }), f(3, { event: 'approval.responded' })])).toBeNull();
    expect(lastPendingApproval('run_1', [f(1, { event: 'replay.truncated', oldest_retained_seq: 9 })])).toBeNull();
    expect(lastPendingApproval('run_1', [f(7, { event: 'approval.request', command: 'ls' })])?.key).toBe('run_1:seq7');
  });
});

describe('Hermes 0.23 format (gateway session authority)', () => {
  const prompt = { kind: 'approval', prompt_id: 'p1', execution_generation: 3, command: 'rm x', description: 'Supprimer', choices: ['once', 'deny'] };

  it('reads prompt_id and approval.settled in the events', () => {
    const frames = [{ id: '1', data: { event: 'approval.request', ...prompt } }];
    expect(lastPendingApproval('run_1', frames)).toMatchObject({ key: 'run_1:p1', requestId: 'p1', command: 'rm x', choices: ['once', 'deny'] });
    expect(lastPendingApproval('run_1', [...frames, { id: '2', data: { event: 'approval.settled', prompt_id: 'p1', execution_generation: 3 } }])).toBeNull();
  });

  it('reads the approval listed in the run status', () => {
    expect(pendingFromStatus('run_1', [prompt])).toMatchObject({ key: 'run_1:p1', requestId: 'p1', description: 'Supprimer' });
    // a question of the agent: second, after any approval
    const question = { kind: 'clarify', prompt_id: 'c1', execution_generation: 3, question: 'Quel magasin ?', choices: ['A', 'B'], multi_select: true };
    expect(pendingFromStatus('run_1', [question])).toEqual({
      kind: 'clarify', key: 'run_1:c1', requestId: 'c1', question: 'Quel magasin ?', choices: ['A', 'B'], multiSelect: true, command: null, description: null,
    });
    expect(pendingFromStatus('run_1', [question, prompt])?.kind).toBe('approval');
    expect(pendingFromStatus('run_1', [{ ...question, choices: null }])?.choices).toEqual([]);
    expect(pendingFromStatus('run_1', [])).toBeNull();
  });

  it('builds the exact answer body, or says why it cannot', () => {
    const status = (pending: unknown[]) => ({ run_id: 'run_1', status: 'waiting_for_approval', execution_generation: 3, pending_controls: pending });
    expect(controlBody('approval', status([prompt]), null, 'once')).toEqual({ body: { request_id: 'p1', execution_generation: 3, choice: 'once' } });
    expect(controlBody('approval', status([prompt, { ...prompt, prompt_id: 'p2' }]), 'p2', 'deny')).toEqual({ body: { request_id: 'p2', execution_generation: 3, choice: 'deny' } });
    expect(controlBody('approval', status([prompt, { ...prompt, prompt_id: 'p2' }]), null, 'once')).toEqual({ code: 'ambiguous' });
    expect(controlBody('approval', status([]), 'p1', 'once')).toEqual({ code: 'no_pending' });
    // without the authority: the former body
    expect(controlBody('approval', { run_id: 'run_1', status: 'waiting_for_approval' }, 'apr_1', 'once')).toEqual({ body: { choice: 'once', request_id: 'apr_1' } });
    expect(controlBody('approval', null, null, 'deny')).toEqual({ body: { choice: 'deny' } });
    // clarify: answer instead of choice, never confused with an approval
    const q = { kind: 'clarify', prompt_id: 'c1', execution_generation: 3, question: 'Q', choices: [] };
    expect(controlBody('clarify', status([prompt, q]), null, 'Frouard')).toEqual({ body: { request_id: 'c1', execution_generation: 3, answer: 'Frouard' } });
    expect(controlBody('clarify', status([prompt]), null, 'x')).toEqual({ code: 'no_pending' });
  });
});
