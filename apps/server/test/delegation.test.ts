import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { delegationInfo, delegationState, readTicket } from '../src/chat/delegation.js';
import { toChatMessages } from '../src/chat/history.js';
import { cutBefore } from '../src/sessions/copy.js';

const sample = readFileSync(join(import.meta.dirname, 'fixtures', 'delegation-batch.txt'), 'utf8');

const batch = (sections: string[], extra = '') => [
  '[ASYNC DELEGATION BATCH COMPLETE — deleg_x1]', 'A background fan-out unit you dispatched earlier — 3 subagent(s) — has finished.', '',
  'Role: leaf   Total duration: 12.5s', extra, '', ...sections,
].join('\n');

describe('delegationInfo (text of Hermes 0.23, no display_metadata)', () => {
  it('real sample: one task completed, id and duration from the text', () => {
    expect(delegationInfo(undefined, sample)).toEqual({
      id: 'deleg_b4eb8746', tasks: 1, completed: 1, failed: 0, durationSeconds: 1301.42, failedTask: null,
      taskStatuses: [{ index: 0, status: 'completed' }], allFailed: false,
    });
  });

  it('mixed batch: ✓ / ✗ / ⚠, status words mapped', () => {
    const info = delegationInfo(null, batch([
      '--- ✓ TASK 1/4: Relire  (status=completed, api_calls=3, 4.1s) ---', 'ok', '',
      '--- ✗ TASK 2/4: Compter  (status=error, 2s) ---', 'Error: x', '',
      '--- ⚠ TASK 3/4: Résumer  (status=completed, 9s) ---', '[TRUNCATED: hit max_iterations]', '',
      '--- ✓ TASK 4/4: Classer (status=interrupted)  (status=?, 1s) ---',
    ]));
    expect(info.taskStatuses).toEqual([
      { index: 0, status: 'completed' }, { index: 1, status: 'failed' }, { index: 2, status: 'truncated' }, { index: 3, status: 'unknown' },
    ]);
    expect([info.id, info.tasks, info.failed, info.completed, info.durationSeconds]).toEqual(['deleg_x1', 4, 1, 3, 12.5]);
  });

  it('keeps an unknown status word, maps success / rejected', () => {
    const info = delegationInfo(undefined, batch([
      '--- ✗ TASK 1/3: a  (status=timeout, 1s) ---', '--- ✓ TASK 2/3: b  (status=success, 1s) ---', '--- ✗ TASK 3/3: c  (status=rejected, 1s) ---',
    ]));
    expect(info.taskStatuses.map((t) => t.status)).toEqual(['timeout', 'completed', 'failed']);
  });

  it('single child: Status line before --- RESULT ---, truncation, duration', () => {
    const one = (status: string) => ['[ASYNC DELEGATION COMPLETE — deleg_one]', 'A background subagent you dispatched earlier has finished.', '',
      'Original goal: Lire', 'Role: leaf', `Status: ${status}`, '--- RESULT ---', 'Status: completed (in the result text)'].join('\n');
    expect(delegationInfo(undefined, one('failed   Duration: 3.2s'))).toMatchObject({ id: 'deleg_one', tasks: 1, failed: 1, completed: 0, durationSeconds: 3.2, taskStatuses: [{ index: null, status: 'failed' }] });
    expect(delegationInfo(undefined, one('completed   API calls: 5   Duration: 61s [TRUNCATED: hit max_iterations — work may be incomplete]')).taskStatuses)
      .toEqual([{ index: null, status: 'truncated' }]);
  });

  it('early failure notice: id and failed task only', () => {
    const info = delegationInfo(undefined, '[ASYNC DELEGATION TASK FAILED — deleg_x1, task 2/3]\nA background subagent failed.');
    expect(info).toMatchObject({ id: 'deleg_x1', failedTask: 1, tasks: null, failed: null, taskStatuses: [] });
  });

  it('batch without results: allFailed', () => {
    const info = delegationInfo(undefined, batch([], '--- ERROR ---\nThe batch did not complete successfully: boom'));
    expect(info).toMatchObject({ allFailed: true, tasks: null, taskStatuses: [] });
  });

  it('valid metadata wins, malformed metadata keeps the text values; nothing readable → id null', () => {
    expect(delegationInfo({ delegation_id: 'deleg_md', task_count: 2, failed_count: 0, completed_count: 2, duration_seconds: 7 }, sample))
      .toMatchObject({ id: 'deleg_md', tasks: 2, failed: 0, durationSeconds: 7 });
    expect(delegationInfo({ delegation_id: '', task_count: '2', failed_count: -1, duration_seconds: 'x' }, sample))
      .toMatchObject({ id: 'deleg_b4eb8746', tasks: 1, failed: 0, durationSeconds: 1301.42 });
    expect(delegationInfo({ delivery_notice: 'task_failure:0', delegation_id: 'd' }, 'texte libre')).toMatchObject({ id: 'd', failedTask: 0 });
    expect(delegationInfo(undefined, 'texte libre')).toMatchObject({ id: null, tasks: null, taskStatuses: [] });
  });
});

describe('toChatMessages', () => {
  it('delivery → role delegation, hidden rows dropped, steer unchanged', () => {
    const out = toChatMessages([
      { id: 3, role: 'user', content: sample, display_kind: 'async_delegation_complete', timestamp: 30 },
      { id: 2, role: 'user', content: '', display_kind: 'hidden', timestamp: 20 },
      { id: 1, role: 'user', content: 'plus court', display_kind: 'steer', timestamp: 10 },
    ]);
    expect(out.map((m) => [m.id, m.role, m.steer ?? false])).toEqual([[1, 'user', true], [3, 'delegation', false]]);
    expect(out[1]!.delegation?.id).toBe('deleg_b4eb8746');
    expect(out[1]!.content).toBe(sample);
  });
});

describe('cutBefore', () => {
  it('refuses a delivery row as a cut point', () => {
    const exported = { session: {}, messages: [{ id: 1, role: 'user', content: 'a' }, { id: 2, role: 'user', content: sample, display_kind: 'async_delegation_complete' }] };
    expect(() => cutBefore(exported as never, 2)).toThrow(/point de départ/);
    expect(cutBefore(exported as never, 1).exported.messages).toEqual([]);
  });
});

describe('export', () => {
  it('names a delivery « Sous-agents (résultat) », not « Vous »', async () => {
    const { toMarkdown } = await import('../src/sessions/export.js');
    const md = toMarkdown({ title: 'T', startedAt: null, agent: 'Hermes' }, toChatMessages([{ id: 1, role: 'user', content: sample, display_kind: 'async_delegation_complete' }]));
    expect(md).toContain('## Sous-agents (résultat)');
    expect(md).not.toContain('## Vous');
  });
});

describe('tickets (delegate_task in the background)', () => {
  const raw = (t: Record<string, unknown>) => JSON.stringify({ status: 'dispatched', mode: 'background', ...t });

  it('readTicket: refused as an array, units, anything else null', () => {
    const t = readTicket(raw({ delegation_id: 'd1', goals: ['a', 'b', 'c'], refused: [{ task_index: 2 }, { task_index: 2 }] }));
    expect(t).toEqual({ delegationId: 'd1', goals: ['a', 'b', 'c'], refused: [2], units: [] });
    expect(readTicket(raw({ delegation_id: 'd2', goals: ['a', 'b'], units: [{ delegation_id: 'd2-1', task_indexes: [0] }, { delegation_id: 'd2-2', task_indexes: [1] }] }))?.units)
      .toEqual([{ id: 'd2-1', tasks: [0] }, { id: 'd2-2', tasks: [1] }]);
    expect(readTicket(JSON.stringify({ status: 'dispatched', mode: 'sync' }))).toBeNull();
    expect(readTicket('pas du json')).toBeNull();
  });

  it('toChatMessages: ticket on the tool message only', () => {
    const out = toChatMessages([
      { id: 1, role: 'tool', content: raw({ delegation_id: 'd1', goals: ['a'] }), tool_name: 'delegate_task' },
      { id: 2, role: 'tool', content: '{"status":"ok"}', tool_name: 'terminal' },
      { id: 3, role: 'assistant', content: raw({ delegation_id: 'd9' }) },
    ]);
    expect(out[0]!.ticket?.delegationId).toBe('d1');
    expect(out[1]!.ticket).toBeUndefined();
    expect(out[2]!.ticket).toBeUndefined();
  });

  it('delegationState: open units, open tasks without the refused ones, an early notice keeps the unit open', () => {
    const t1 = readTicket(raw({ delegation_id: 'd1', goals: ['a', 'b', 'c'], refused: [{ task_index: 2 }] }))!;
    const t2 = readTicket(raw({ delegation_id: 'd2', goals: ['x', 'y'], units: [{ delegation_id: 'd2-1', task_indexes: [0] }, { delegation_id: 'd2-2', task_indexes: [1] }] }))!;
    const notice = { id: 'd1', tasks: null, completed: null, failed: null, durationSeconds: null, failedTask: 0, taskStatuses: [], allFailed: false };
    const msgs = [
      { role: 'tool', timestamp: 10, ticket: t1 },
      { role: 'tool', timestamp: 20, ticket: t2 },
      { role: 'delegation', timestamp: 30, delegation: notice },
      { role: 'delegation', timestamp: 40, delegation: { ...notice, id: 'd2-1', failedTask: null } },
    ];
    const s = delegationState(msgs);
    expect([...s.open.keys()].sort()).toEqual(['d1', 'd2-2']);
    expect(s.openTasks).toBe(3);
    expect(s.since).toBe(20);
    const done = delegationState([...msgs, { role: 'delegation', timestamp: 50, delegation: { ...notice, failedTask: null } }, { role: 'delegation', timestamp: 60, delegation: { ...notice, id: 'd2-2', failedTask: null } }]);
    expect(done.open.size).toBe(0);
    expect(done.openTasks).toBe(0);
    expect(done.since).toBeNull();
  });
});
