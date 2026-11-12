import { describe, expect, it } from 'vitest';
import { toUsage } from '../src/chat/usage.js';

const info = { model: 'anthropic/claude', effective_context_length: 200_000 };

describe('toUsage', () => {
  it('gives the model context size only for the configured model (or Auto)', () => {
    expect(toUsage(null, info, { model: null }).max).toBe(200_000);
    expect(toUsage(null, info, { model: 'anthropic/claude' }).max).toBe(200_000);
    expect(toUsage(null, info, { model: 'openai/gpt' }).max).toBeNull();
    expect(toUsage(null, null, { model: null })).toEqual({ max: null, exact: null, quota: null });
    expect(toUsage(null, { model: 'm', effective_context_length: 0 }, { model: null }).max).toBeNull();
  });

  it('exact figures only when the gateway gives both above 0; quota in percent', () => {
    const stats = { context_tokens: 12_345, context_length: 200_000, plan_gauge: { label: 'Plan Pro', used_bp: 4200, resets_at_ms: 99 } };
    expect(toUsage(stats, info, { model: null })).toEqual({
      max: 200_000, exact: { used: 12_345, max: 200_000 }, quota: { label: 'Plan Pro', usedPercent: 42, resetsAt: 99 },
    });
    expect(toUsage({ context_tokens: 0, context_length: 200_000, plan_gauge: null }, info, { model: null }).exact).toBeNull();
    expect(toUsage({ context_tokens: 5, context_length: null, plan_gauge: { label: null, used_bp: 20_000, resets_at_ms: null } }, null, { model: null }))
      .toEqual({ max: null, exact: null, quota: { label: null, usedPercent: 100, resetsAt: null } });
  });
});
