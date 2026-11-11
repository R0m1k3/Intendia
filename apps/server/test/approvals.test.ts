import { describe, expect, it } from 'vitest';
import { lastPendingApproval } from '../src/agents/approvals.js';

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
      key: 'run_1:r2', requestId: 'r2', command: 'rm x', description: 'Supprimer', choices: ['once', 'deny'],
    });
  });

  it('nothing once answered, nothing without request; seq key without request_id', () => {
    expect(lastPendingApproval('run_1', [f(2, { event: 'approval.request', request_id: 'r1' }), f(3, { event: 'approval.responded' })])).toBeNull();
    expect(lastPendingApproval('run_1', [f(1, { event: 'replay.truncated', oldest_retained_seq: 9 })])).toBeNull();
    expect(lastPendingApproval('run_1', [f(7, { event: 'approval.request', command: 'ls' })])?.key).toBe('run_1:seq7');
  });
});
