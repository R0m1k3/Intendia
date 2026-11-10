import { describe, expect, it } from 'vitest';
import type { RunStat } from '../api';
import type { Entry } from './events';
import { stepsLabel, toTurns, type ToolEntry } from './turns';

const user = (key: string, ts = 1): Entry => ({ kind: 'user', key, text: key, ts });
const said = (key: string, ts: number | null = 2, streaming = false): Entry => ({ kind: 'assistant', key, text: `texte ${key}`, ts, streaming });
const tool = (key: string, duration: number | null = null): ToolEntry => ({ kind: 'tool', key, callId: null, tool: 'terminal', preview: '', result: null, duration, state: 'ok', ts: 2 });
const note = (key: string): Entry => ({ kind: 'note', key, text: 'n', tone: 'muted', ts: 3 });
const stat = (runId: string) => ({ runId }) as RunStat;

describe('toTurns', () => {
  it('one turn per user message, agent entries grouped, consecutive tools in one card', () => {
    const t = toTurns([user('u1'), tool('t1'), tool('t2'), said('a1'), tool('t3'), note('n1'), said('a2'), user('u2')]);
    expect(t.map((x) => [x.kind, x.key])).toEqual([['user', 'u1'], ['agent', 't1'], ['user', 'u2']]);
    const agent = t[1]!;
    if (agent.kind !== 'agent') throw new Error('agent turn');
    expect(agent.parts.map((p) => [p.kind, p.key])).toEqual([['steps', 't1'], ['assistant', 'a1'], ['steps', 't3'], ['note', 'n1'], ['assistant', 'a2']]);
    expect(agent.parts[0]!.kind === 'steps' && agent.parts[0]!.tools.map((x) => x.key)).toEqual(['t1', 't2']);
    expect(agent.text).toBe('texte a1\n\ntexte a2');
    expect(agent.streaming).toBe(false);
  });

  it('a run line on a tool goes at the end of its turn; on a user message, after it', () => {
    const footers = new Map([['t1', [stat('r1')]], ['u2', [stat('r2')]]]);
    const t = toTurns([user('u1'), tool('t1'), said('a1'), user('u2')], footers);
    expect(t[1]!.footers.map((f) => f.runId)).toEqual(['r1']);
    expect(t[2]!.footers.map((f) => f.runId)).toEqual(['r2']);
    expect(t[0]!.footers).toEqual([]);
  });

  it('starts with an agent turn when the history begins mid-conversation; streaming and time of the first dated entry', () => {
    const t = toTurns([said('a0', null), said('a1', 5, true)]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'agent', key: 'a0', ts: 5, streaming: true });
  });
});

describe('stepsLabel', () => {
  it('shows the summed duration only when every step has one', () => {
    expect(stepsLabel([tool('a')])).toBe('1 étape');
    expect(stepsLabel([tool('a', 2), tool('b', null)])).toBe('2 étapes');
    expect(stepsLabel([tool('a', 2.25), tool('b', 1)])).toBe('2 étapes · 3,3 s');
    expect(stepsLabel([tool('a', 12), tool('b', 1)])).toBe('2 étapes · 13 s');
  });
});
