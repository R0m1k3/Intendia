import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../api';
import { historyEntries, initialRun, mergeHistory, reduceEvent, subagentTree, withTrees, type Entry, type RunEvent } from './events';

const run = (events: RunEvent[]) => events.reduce(reduceEvent, initialRun());
const msg = (id: number, role: string, content: string, timestamp: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, content, timestamp, toolName: null, toolCalls: [], ...extra,
});

describe('reduceEvent', () => {
  it('concatenates deltas into one streaming answer, closed by a tool call', () => {
    const s = run([
      { event: 'run.started' },
      { event: 'message.delta', delta: 'Je ' },
      { event: 'message.delta', delta: 'regarde.' },
      { event: 'tool.started', tool: 'terminal', preview: 'ls', call_id: 'c1' },
    ]);
    expect(s.entries[0]).toMatchObject({ kind: 'assistant', text: 'Je regarde.', streaming: false });
    expect(s.entries[1]).toMatchObject({ kind: 'tool', tool: 'terminal', state: 'running' });
    expect(s.status).toBe('running');
  });

  it('marks a failed tool by call_id', () => {
    const s = run([
      { event: 'tool.started', tool: 'terminal', preview: 'ls', call_id: 'c1' },
      { event: 'tool.started', tool: 'read_file', preview: 'a.md', call_id: 'c2' },
      { event: 'tool.failed', tool: 'terminal', preview: 'permission denied', call_id: 'c1', duration: 0.2 },
      { event: 'tool.completed', tool: 'read_file', preview: 'ok', call_id: 'c2', duration: 0.1, error: false },
    ]);
    expect(s.entries.map((e) => e.kind === 'tool' && e.state)).toEqual(['failed', 'ok']);
    expect(s.entries[0]).toMatchObject({ result: 'permission denied', duration: 0.2 });
  });

  it('treats replay.truncated as a warning and keeps the run going', () => {
    const s = run([{ event: 'run.started' }, { event: 'replay.truncated', oldest_retained_seq: 4 }, { event: 'message.delta', delta: 'suite' }]);
    expect(s.truncated).toBe(true);
    expect(s.status).toBe('running');
  });

  it('reads approvals in the format of Hermes 0.23 (prompt_id, approval.settled)', () => {
    let s = run([{ event: 'approval.request', prompt_id: 'apr_1', execution_generation: 1, command: 'rm -rf build', choices: ['once', 'deny'] }]);
    expect(s.approval).toMatchObject({ requestId: 'apr_1', command: 'rm -rf build' });
    s = reduceEvent(s, { event: 'approval.settled', prompt_id: 'apr_1', execution_generation: 1 });
    expect(s.approval).toBeNull();
    expect(s.status).toBe('running');
    expect(s.entries.at(-1)).toMatchObject({ kind: 'note', text: 'Approbation répondue' });
  });

  it('handles approvals, failures and unknown events', () => {
    let s = run([{ event: 'approval.request', request_id: 'apr_1', command: 'rm -rf build', choices: ['once', 'deny'] }]);
    expect(s.status).toBe('waiting_for_approval');
    expect(s.approval).toMatchObject({ requestId: 'apr_1', choices: ['once', 'deny'] });
    s = reduceEvent(s, { event: 'approval.responded', choice: 'deny' });
    expect(s.approval).toBeNull();
    s = reduceEvent(s, { event: 'something.new' });
    expect(s.entries.at(-1)).toMatchObject({ kind: 'note', text: 'something.new' });
    s = reduceEvent(s, { event: 'run.failed', error: 'Hermes is not connected to any AI provider yet.' });
    expect(s).toMatchObject({ status: 'failed', error: 'Hermes is not connected to any AI provider yet.' });
  });

  it('uses run.completed output when nothing was streamed', () => {
    const s = run([{ event: 'run.started' }, { event: 'run.completed', output: 'Fait.' }]);
    expect(s.entries).toMatchObject([{ kind: 'assistant', text: 'Fait.' }]);
    expect(s.status).toBe('completed');
  });
});

describe('history', () => {
  it('attaches tool results to their call', () => {
    const e = historyEntries([
      msg(1, 'user', 'Liste', 10),
      msg(2, 'assistant', '', 11, { toolCalls: [{ name: 'terminal', arguments: '{"cmd":"ls"}' }] }),
      msg(3, 'tool', 'a\nb', 12, { toolName: 'terminal' }),
      msg(4, 'assistant', 'Deux fichiers.', 13),
    ]);
    expect(e.map((x) => x.kind)).toEqual(['user', 'tool', 'assistant']);
    expect(e[1]).toMatchObject({ tool: 'terminal', result: 'a\nb' });
  });

  it('merges a running run without duplicates', () => {
    const history = [
      msg(1, 'user', 'Avant', 100), msg(2, 'assistant', 'Réponse avant', 101),
      msg(3, 'user', 'Pendant', 200), msg(4, 'assistant', 'Partiel déjà écrit', 201),
    ];
    const live = run([{ event: 'message.delta', delta: 'Partiel déjà écrit' }]).entries;
    const merged = mergeHistory(history, 199.5, live);
    expect(merged.map((e) => `${e.kind}:${'text' in e ? e.text : ''}`)).toEqual([
      'user:Avant', 'assistant:Réponse avant', 'user:Pendant', 'assistant:Partiel déjà écrit',
    ]);
    // sent from this page: the live entries already carry the user message
    const own = mergeHistory(history, 199.5, [{ kind: 'user', key: 'u', text: 'Pendant', ts: null }, ...live]);
    expect(own.filter((e) => e.kind === 'user')).toHaveLength(2);
  });
});

describe('sub-agents', () => {
  const tree = (events: RunEvent[]) => {
    const s = run(events);
    const entries = s.entries.filter((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents');
    expect(entries).toHaveLength(1);
    return { s, nodes: entries[0]!.nodes };
  };

  it('builds one tree per run, where the first sub-agent started', () => {
    const { s, nodes } = tree([
      { event: 'message.delta', delta: 'Je délègue.' },
      { event: 'subagent.start', subagent_id: 'sa_1', depth: 1, goal: 'Chercher', model: 'm1', timestamp: 10 },
      { event: 'subagent.start', subagent_id: 'sa_2', parent_id: 'sa_1', depth: 2, goal: 'Lire', timestamp: 11 },
      { event: 'subagent.complete', subagent_id: 'sa_2', status: 'completed', duration_seconds: 1.5, cost_usd: 0.01, tool_count: 2, summary: 'Lu' },
      { event: 'message.delta', delta: 'Fini.' },
    ]);
    expect(s.entries.map((e) => e.kind)).toEqual(['assistant', 'subagents', 'assistant']);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ id: 'sa_1', status: 'running', model: 'm1', startedAt: 10 });
    expect(nodes[1]).toMatchObject({ id: 'sa_2', parentId: 'sa_1', status: 'completed', duration: 1.5, cost: 0.01, toolCount: 2, summary: 'Lu' });
    expect(subagentTree(nodes).map((x) => [x.node.id, x.level])).toEqual([['sa_1', 0], ['sa_2', 1]]);
  });

  it('keeps Hermes status, defaults to completed, keys by goal without id', () => {
    const { nodes } = tree([
      { event: 'subagent.start', goal: 'A' },
      { event: 'subagent.start', goal: 'A' },
      { event: 'subagent.complete', goal: 'A', status: 'failed' },
      { event: 'subagent.complete', goal: 'A' },
      { event: 'subagent.complete', subagent_id: 'x', goal: 'Sans début' },
    ]);
    expect(nodes.map((n) => [n.id, n.status])).toEqual([['A#1', 'failed'], ['A#2', 'completed'], ['x', 'completed']]);
  });

  it('hangs unknown parents and cycles off the root', () => {
    const { nodes } = tree([
      { event: 'subagent.start', subagent_id: 'b', parent_id: 'inconnu' },
      { event: 'subagent.start', subagent_id: 'c', parent_id: 'd' },
      { event: 'subagent.start', subagent_id: 'd', parent_id: 'c' },
    ]);
    expect(subagentTree(nodes).map((x) => [x.node.id, x.level])).toEqual([['b', 0], ['c', 0], ['d', 0]]);
  });

  it('puts the trees of finished runs back into the history, by time', () => {
    const history = historyEntries([msg(1, 'user', 'Délègue', 100), msg(2, 'assistant', 'Fini', 120), msg(3, 'user', 'Merci', 130)]);
    const t = { kind: 'subagents' as const, key: 'sa-1', nodes: [], ts: 105 };
    expect(withTrees(history, [t]).map((e) => e.key)).toEqual(['h1', 'sa-1', 'h2', 'h3']);
    expect(withTrees(history, [{ ...t, ts: 200 }]).map((e) => e.key).at(-1)).toBe('sa-1');
  });

  it('keeps apart the trees of two runs whose first sub-agent has the same seq', () => {
    const first = (runId: string) => reduceEvent(initialRun(), { event: 'subagent.start', run_id: runId, seq: 2, subagent_id: 'x', goal: runId })
      .entries.find((e): e is Extract<Entry, { kind: 'subagents' }> => e.kind === 'subagents')!;
    const a = first('run_a');
    const b = first('run_b');
    expect(a.key).not.toBe(b.key);
    expect(withTrees([], [a, b]).length).toBe(2);
  });
});
