import { describe, expect, it } from 'vitest';
import type { RunStat } from '../api';
import type { Entry } from './events';
import { agentName, cacheShare, costSettling, formatCost, formatDuration, formatShare, formatTokens, placeRunStats, shortModel } from './format';

describe('formats', () => {
  it('tokens', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1,0 k');
    expect(formatTokens(5200)).toBe('5,2 k');
    expect(formatTokens(12_000)).toBe('12 k');
    expect(formatTokens(622_000)).toBe('622 k');
    expect(formatTokens(1_250_000)).toBe('1,3 M');
  });
  it('durations', () => {
    expect(formatDuration(59_000)).toBe('59 s');
    expect(formatDuration(68_000)).toBe('1 min 8 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(3_720_000)).toBe('1 h 2 min');
  });
  it('costs, cache share, model names', () => {
    expect(formatCost(0.39)).toBe('0,39 $');
    expect(formatCost(0.0042)).toBe('0,0042 $');
    expect(cacheShare({ inputTokens: 0, cacheReadTokens: 0 })).toBeNull();
    expect(cacheShare({ inputTokens: null, cacheReadTokens: null })).toBeNull();
    expect(formatShare(cacheShare({ inputTokens: 12_000, cacheReadTokens: 9_000 })!)).toBe('75,0 %');
    expect(shortModel('anthropic/claude-opus-4.6')).toBe('claude-opus-4.6');
    expect(shortModel('gpt-5')).toBe('gpt-5');
  });
});

const run = (id: string, startedAt: number, endedAt: number | null): RunStat => ({
  runId: id, status: 'completed', requestedModel: null, requestedEffort: null, servedModel: null, startedAt, endedAt,
  inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null, costRuns: 1, costFinal: true,
});
const e = (key: string, ts: number | null, kind: 'user' | 'assistant' = 'assistant'): Entry => ({ kind, key, text: key, ts });

describe('placeRunStats', () => {
  const history = [e('u1', 100, 'user'), e('a1', 110), e('u2', 200, 'user'), e('a2', 230)];

  it('puts each run after the last entry written before it ended', () => {
    const m = placeRunStats(history, [run('r2', 199_000, 231_000), run('r1', 99_000, 111_500)]);
    expect([...m.entries()].map(([k, v]) => [k, v.map((r) => r.runId)])).toEqual([['a1', ['r1']], ['a2', ['r2']]]);
  });

  it('a reply Hermes did not keep does not shift the next runs; two runs may share an entry', () => {
    const lost = [e('u1', 100, 'user'), e('u2', 200, 'user'), e('a2', 230)];
    const m = placeRunStats(lost, [run('r1', 99_000, 105_000), run('r2', 199_000, 231_000)]);
    expect(m.get('u1')!.map((r) => r.runId)).toEqual(['r1']);
    expect(m.get('a2')!.map((r) => r.runId)).toEqual(['r2']);
    const shared = placeRunStats(history, [run('r3', 240_000, 250_000), run('r4', 260_000, null)]);
    expect(shared.get('a2')!.map((r) => r.runId)).toEqual(['r3', 'r4']);
  });

  it('a quick next message does not pull a run past the start of the next run', () => {
    const quick = [e('u1', 100, 'user'), e('a1', 100.5), e('u2', 101, 'user'), e('a2', 101.5)];
    const m = placeRunStats(quick, [run('r1', 99_900, 100_600), run('r2', 100_950, 101_600)]);
    expect(m.get('a1')!.map((r) => r.runId)).toEqual(['r1']);
    expect(m.get('a2')!.map((r) => r.runId)).toEqual(['r2']);
  });

  it('runs older than the loaded history are not shown; entries without time are not anchors', () => {
    const m = placeRunStats([e('x', null), ...history], [run('old', 10_000, 20_000)]);
    expect(m.size).toBe(0);
  });
});

describe('costSettling', () => {
  const now = 1_000_000;
  it('re-reads only the last reply, while its cost is not final and for a bounded time', () => {
    expect(costSettling(undefined, now)).toBe(false);
    expect(costSettling([], now)).toBe(false);
    expect(costSettling([run('a', 0, now - 1_000)], now)).toBe(false); // final
    const settling = { ...run('a', 0, now - 1_000), costFinal: false };
    expect(costSettling([settling], now)).toBe(true);
    expect(costSettling([settling, run('b', 0, now)], now)).toBe(false);
    expect(costSettling([{ ...settling, endedAt: now - 60_000 }], now)).toBe(false);
    expect(costSettling([{ ...settling, endedAt: null }], now)).toBe(false);
    expect(costSettling([{ ...settling, status: 'unknown' }], now)).toBe(false);
  });
});

describe('agentName', () => {
  it('names a non-default agent by its profile, else by the instance', () => {
    expect(agentName('redacteur', 'Maison')).toBe('redacteur');
    expect(agentName('default', 'Maison')).toBe('Maison');
    expect(agentName(undefined, 'Maison')).toBe('Maison');
    expect(agentName('default', '  ')).toBe('Hermes');
    expect(agentName(null, undefined)).toBe('Hermes');
  });
});
