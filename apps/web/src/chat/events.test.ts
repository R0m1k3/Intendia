import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../api';
import { historyEntries, initialRun, mergeHistory, reduceEvent, type RunEvent } from './events';

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
