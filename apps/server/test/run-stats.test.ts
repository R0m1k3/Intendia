import { describe, expect, it } from 'vitest';
import { finishFields, runCost, sessionCost } from '../src/chat/run-stats.js';

describe('finishFields', () => {
  const usage = { input_tokens: 622_000, output_tokens: 5_200, total_tokens: 627_200, cache_read_tokens: 600_852, cache_write_tokens: 1_000 };

  it('reads usage, runtime and Hermes times (seconds → ms)', () => {
    expect(finishFields({ status: 'completed', created_at: 100, updated_at: 168.5, usage, runtime: { provider: 'x', model: 'anthropic/claude-opus-4.6' } }, 1)).toEqual({
      status: 'completed', startedAt: 100_000, endedAt: 168_500, servedModel: 'anthropic/claude-opus-4.6',
      inputTokens: 622_000, outputTokens: 5_200, cacheReadTokens: 600_852, cacheWriteTokens: 1_000,
    });
  });

  it('no usage, an empty one or a zero total = tokens unknown; no runtime = served model unknown', () => {
    for (const u of [undefined, null, {}, { ...usage, total_tokens: 0 }, { input_tokens: 5 }]) {
      const f = finishFields({ status: 'failed', usage: u }, 7);
      expect(f).toMatchObject({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, servedModel: null });
    }
  });

  it('falls back to the server clock without Hermes times', () => {
    expect(finishFields({ status: 'completed' }, 42)).toMatchObject({ startedAt: null, endedAt: 42 });
  });
});

describe('costs', () => {
  it('session cost: actual first, then estimated, null = nothing counted yet', () => {
    expect(sessionCost({ actual_cost_usd: 0.5, estimated_cost_usd: 0.4 })).toBe(0.5);
    expect(sessionCost({ actual_cost_usd: null, estimated_cost_usd: 0.4 })).toBe(0.4);
    expect(sessionCost({ estimated_cost_usd: null })).toBe(0);
  });

  it('run cost: difference on the same live session, unknown otherwise', () => {
    expect(runCost(0.1, 's', { sessionId: 's', cost: 0.49 })).toBe(0.39);
    expect(runCost(0, 's', { sessionId: 's', cost: 0 })).toBe(0);
    expect(runCost(0.1, 's', { sessionId: 'continuation', cost: 0.2 })).toBeNull();
    expect(runCost(0.5, 's', { sessionId: 's', cost: 0.2 })).toBeNull();
    expect(runCost(null, 's', { sessionId: 's', cost: 0.2 })).toBeNull();
    expect(runCost(0.1, 's', null)).toBeNull();
  });
});
