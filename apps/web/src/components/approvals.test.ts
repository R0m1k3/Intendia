import { describe, expect, it } from 'vitest';
import type { PendingApproval } from '../api';
import { toNotify, visibleApprovals } from './approvals';

const a = (key: string, sessionId = 's1'): PendingApproval => ({
  key, instanceId: 'b', instanceLabel: 'Bureau', workspace: 'w', workspaceName: 'W', sessionId, title: null, runId: 'r',
  requestId: null, command: null, description: null, choices: [], canAnswer: true,
});

describe('approvals', () => {
  it('hides the session on screen and those put aside; a new request of the same run shows again', () => {
    const list = [a('r1:apr_1', 's1'), a('r2:apr_1', 's2')];
    expect(visibleApprovals(list, { openSession: 's1', hidden: new Set() }).map((x) => x.key)).toEqual(['r2:apr_1']);
    expect(visibleApprovals(list, { hidden: new Set(['r2:apr_1']) }).map((x) => x.key)).toEqual(['r1:apr_1']);
    expect(visibleApprovals([a('r2:apr_2', 's2')], { hidden: new Set(['r2:apr_1']) })).toHaveLength(1);
  });
  it('notifies each key once', () => {
    const seen = new Set<string>();
    expect(toNotify([a('k1'), a('k2')], seen)).toHaveLength(2);
    expect(toNotify([a('k1'), a('k3')], seen).map((x) => x.key)).toEqual(['k3']);
  });
});
