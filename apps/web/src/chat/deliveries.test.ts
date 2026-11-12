import { describe, expect, it } from 'vitest';
import type { ChatMessage, DelegationInfo, SubagentChild } from '../api';
import { applyDeliveries, attachChildren, delegationState, deliverySummary, EMPTY_DELIVERY, pollDelay } from './deliveries';
import { historyEntries, withTrees, type Entry, type SubagentNode } from './events';

const msg = (id: number, role: string, content: string, ts = id, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role, content, toolName: null, toolCalls: [], timestamp: ts, ...extra });
const call = (id: number, args: unknown, ts = id) => msg(id, 'assistant', '', ts, { toolCalls: [{ name: 'delegate_task', arguments: JSON.stringify(args) }] });
const ticket = (id: number, t: Record<string, unknown>, ts = id) => msg(id, 'tool', JSON.stringify({ status: 'dispatched', mode: 'background', ...t }), ts, { toolName: 'delegate_task' });
const info = (p: Partial<DelegationInfo>): DelegationInfo => ({ ...EMPTY_DELIVERY, ...p });
const delivery = (id: number, p: Partial<DelegationInfo>, ts = id) => msg(id, 'delegation', 'texte', ts, { delegation: info(p) });

const goals = ['Relire les ventes', 'Compter les rayons', 'Tâche refusée'];
const base = [
  msg(1, 'user', 'fond', 1),
  call(2, { tasks: goals.map((goal) => ({ goal })) }, 2),
  ticket(3, { delegation_id: 'd1', goals, refused: [{ task_index: 2 }] }, 3),
  msg(4, 'assistant', 'Je vous préviens.', 4),
];
const cards = (entries: Entry[]) => entries.filter((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents');
const statuses = (entries: Entry[]) => cards(entries).flatMap((c) => c.nodes.map((n) => `${n.taskIndex}:${n.status}`));

describe('historyEntries: background tickets and deliveries', () => {
  it('a ticket becomes a card without the refused task; a delivery its own entry', () => {
    const e = historyEntries([...base, delivery(5, { id: 'd1', tasks: 2, failed: 1 })]);
    const [card] = cards(e);
    expect(card!.nodes.map((n) => [n.goal, n.status, n.delegationId, n.taskIndex, n.startedAt])).toEqual([
      ['Relire les ventes', 'background', 'd1', 0, 3], ['Compter les rayons', 'background', 'd1', 1, 3],
    ]);
    expect(e.some((x) => x.kind === 'tool')).toBe(false);
    expect(e.at(-1)).toMatchObject({ kind: 'delegation', key: 'h5', summary: '2 sous-agents, 1 en échec' });
  });

  it('units: each node carries the id of its unit', () => {
    const e = historyEntries([call(2, { tasks: [{ goal: 'a' }, { goal: 'b' }] }), ticket(3, { delegation_id: 'd1', goals: ['a', 'b'], units: [{ delegation_id: 'd1-0', task_indexes: [0] }, { delegation_id: 'd1-1', task_indexes: [1] }] })]);
    expect(cards(e)[0]!.nodes.map((n) => n.delegationId)).toEqual(['d1-0', 'd1-1']);
  });

  it('a synchronous result is unchanged', () => {
    const e = historyEntries([call(2, { goal: 'x' }), msg(3, 'tool', JSON.stringify({ results: [{ task_index: 0, status: 'completed', summary: 'ok' }] }), 3, { toolName: 'delegate_task' })]);
    expect(cards(e)[0]!.nodes[0]).toMatchObject({ status: 'completed', delegationId: null, taskIndex: 0, childSessionId: null });
  });
});

describe('delegationState', () => {
  it('ticket alone: open since its time; an early notice keeps it open; a delivery closes it', () => {
    expect(delegationState(base)).toMatchObject({ since: 3 });
    expect([...delegationState(base).open]).toEqual(['d1']);
    expect([...delegationState([...base, delivery(5, { id: 'd1', failedTask: 1 })]).open]).toEqual(['d1']);
    const closed = delegationState([...base, delivery(5, { id: 'd1', tasks: 2 })]);
    expect(closed.open.size).toBe(0);
    expect(closed.since).toBeNull();
  });

  it('two units, one delivered: one open, unitOf filled', () => {
    const s = delegationState([
      ticket(3, { delegation_id: 'd1', goals: ['a', 'b'], units: [{ delegation_id: 'd1-0', task_indexes: [0] }, { delegation_id: 'd1-1', task_indexes: [1] }] }),
      delivery(5, { id: 'd1-0', tasks: 1 }),
    ]);
    expect([...s.open]).toEqual(['d1-1']);
    expect(s.unitOf.get('d1')?.get(1)).toBe('d1-1');
  });
});

describe('applyDeliveries', () => {
  it('statuses per task from the delivery, openSince while some are in the background', () => {
    const before = applyDeliveries(historyEntries(base), delegationState(base), false);
    expect(cards(before)[0]!.openSince).toBe(3);
    const msgs = [...base, delivery(5, { id: 'd1', tasks: 2, failed: 1, taskStatuses: [{ index: 0, status: 'completed' }, { index: 1, status: 'failed' }] })];
    const after = applyDeliveries(historyEntries(msgs), delegationState(msgs), false);
    expect(statuses(after)).toEqual(['0:completed', '1:failed']);
    expect(cards(after)[0]!.openSince).toBeUndefined();
  });

  it('single child (index null), fallbacks on the numbers, allFailed', () => {
    const run = (p: Partial<DelegationInfo>) => {
      const msgs = [...base, delivery(5, { id: 'd1', ...p })];
      return statuses(applyDeliveries(historyEntries(msgs), delegationState(msgs), false));
    };
    expect(run({ taskStatuses: [{ index: null, status: 'truncated' }] })).toEqual(['0:truncated', '1:truncated']);
    expect(run({ tasks: 2, failed: 0 })).toEqual(['0:completed', '1:completed']);
    expect(run({ tasks: 2, failed: 2 })).toEqual(['0:failed', '1:failed']);
    expect(run({ allFailed: true })).toEqual(['0:failed', '1:failed']);
    expect(run({ failedTask: 1 })).toEqual(['0:background', '1:failed']);
  });

  it('a delivery without id changes nothing', () => {
    const msgs = [...base, delivery(5, { id: null, tasks: 2 })];
    expect(statuses(applyDeliveries(historyEntries(msgs), delegationState(msgs), false))).toEqual(['0:background', '1:background']);
  });

  it('live card: running nodes become background once the run is over, then get their unit status', () => {
    const node = (i: number): SubagentNode => ({
      id: `sa_bg${i + 1}`, parentId: null, depth: 1, goal: goals[i]!, model: null, status: 'running', startedAt: 2, duration: null, cost: null,
      inputTokens: null, outputTokens: null, toolCount: null, summary: null, delegationId: 'd1', taskIndex: i, childSessionId: `c${i}`,
    });
    const live: Extract<Entry, { kind: 'subagents' }> = { kind: 'subagents', key: 'sa-run_1-0', nodes: [node(0), node(1)], ts: 2 };
    const msgs = [...base];
    const tree = withTrees(historyEntries(msgs), [live]);
    expect(cards(tree).map((c) => c.key)).toEqual(['sa-run_1-0']);
    expect(statuses(applyDeliveries(tree, delegationState(msgs), true))).toEqual(['0:running', '1:running']);
    expect(statuses(applyDeliveries(tree, delegationState(msgs), false))).toEqual(['0:background', '1:background']);
    const done = [...msgs, delivery(5, { id: 'd1', taskStatuses: [{ index: 0, status: 'completed' }, { index: 1, status: 'failed' }] })];
    expect(statuses(applyDeliveries(withTrees(historyEntries(done), [live]), delegationState(done), false))).toEqual(['0:completed', '1:failed']);
  });

  it('live node with the call id + ticket in units: status of its own unit', () => {
    const msgs = [
      ticket(3, { delegation_id: 'd1', goals: ['a', 'b'], units: [{ delegation_id: 'd1-0', task_indexes: [0] }, { delegation_id: 'd1-1', task_indexes: [1] }] }),
      delivery(5, { id: 'd1-1', taskStatuses: [{ index: 1, status: 'failed' }] }),
    ];
    const live: Entry = { kind: 'subagents', key: 'sa-x', ts: 1, nodes: [0, 1].map((i): SubagentNode => ({
      id: `n${i}`, parentId: null, depth: 1, goal: 'g', model: null, status: 'running', startedAt: 1, duration: null, cost: null,
      inputTokens: null, outputTokens: null, toolCount: null, summary: null, delegationId: 'd1', taskIndex: i, childSessionId: null,
    })) };
    expect(statuses(applyDeliveries([live], delegationState(msgs), false))).toEqual(['0:background', '1:failed']);
  });
});

describe('attachChildren', () => {
  const kid = (p: Partial<SubagentChild>): SubagentChild => ({
    id: 'k', goal: '', cut: false, startedAt: 3, endedAt: null, endReason: null, lastActive: 10, toolCalls: 2, apiCalls: 1, ...p,
  });
  const open = applyDeliveries(historyEntries(base), delegationState(base), false);
  const acts = (e: Entry[]) => cards(e)[0]!.nodes.map((n) => n.activity ?? null);

  it('by goal (equal, or cut prefix), each child once, ended children', () => {
    const out = attachChildren(open, [
      kid({ id: 'a', goal: 'compter  les', cut: true, toolCalls: 7, lastActive: 50 }),
      kid({ id: 'b', goal: 'Relire les ventes', endedAt: 40 }),
    ]);
    expect(acts(out)).toEqual([{ lastActive: 10, toolCalls: 2, ended: true }, { lastActive: 50, toolCalls: 7, ended: false }]);
  });

  it('by child session id first; a child started long before the node is ignored; an empty goal never matches', () => {
    const withIds: Entry[] = open.map((e) => (e.kind === 'subagents' ? { ...e, nodes: e.nodes.map((n, i) => ({ ...n, childSessionId: i === 0 ? 'x0' : null })) } : e));
    const out = attachChildren(withIds, [
      kid({ id: 'x0', goal: 'autre but', toolCalls: 1 }),
      kid({ id: 'old', goal: 'Compter les rayons', startedAt: 3 - 200 }),
      kid({ id: 'empty', goal: '' }),
    ]);
    expect(acts(out)).toEqual([{ lastActive: 10, toolCalls: 1, ended: false }, null]);
  });

  it('two nodes with the same beginning: in the order of the children', () => {
    const same = historyEntries([call(2, { tasks: [{ goal: 'Lire A' }, { goal: 'Lire A' }] }), ticket(3, { delegation_id: 'd', goals: ['Lire A', 'Lire A'] })]);
    const out = attachChildren(same, [kid({ id: '1', goal: 'Lire A', toolCalls: 1 }), kid({ id: '2', goal: 'Lire A', toolCalls: 2 })]);
    expect(acts(out).map((a) => a?.toolCalls)).toEqual([1, 2]);
  });
});

describe('deliverySummary', () => {
  it('exact strings', () => {
    expect(deliverySummary(info({ failedTask: 1 }))).toBe('Sous-agent 2 en échec (les autres continuent)');
    expect(deliverySummary(info({}))).toBe('Résultat des sous-agents');
    expect(deliverySummary(info({ tasks: 1, failed: 0 }))).toBe('1 sous-agent terminé');
    expect(deliverySummary(info({ tasks: 3, failed: 0 }))).toBe('3 sous-agents terminés');
    expect(deliverySummary(info({ tasks: 1, failed: 1 }))).toBe('1 sous-agent en échec');
    expect(deliverySummary(info({ tasks: 2, failed: 2 }))).toBe('2 sous-agents en échec');
    expect(deliverySummary(info({ tasks: 2, failed: 1, durationSeconds: 6 }))).toBe('2 sous-agents, 1 en échec · 6 s');
    expect(deliverySummary(info({ tasks: 1, failed: 0, durationSeconds: 1301.42 }))).toBe('1 sous-agent terminé · 21 min 41 s');
  });
});

describe('pollDelay', () => {
  const s = (since: number | null, open = ['d']) => ({ open: new Set(open), since, deliveries: new Map(), unitOf: new Map() });
  it('15 s, then 60 s, then stops after 24 h; nothing open → false', () => {
    expect(pollDelay(s(1000), 1000)).toBe(15_000);
    expect(pollDelay(s(1000), 1601)).toBe(60_000);
    expect(pollDelay(s(1000), 1000 + 86_401)).toBe(false);
    expect(pollDelay(s(null, []), 1000)).toBe(false);
  });
});
