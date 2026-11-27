import { describe, expect, it } from 'vitest';
import type { RunStat } from '../api';
import { fallback, footerItems, tokensPerSecond } from './RunFooter';

const r = (p: Partial<RunStat>): RunStat => ({
  runId: 'r', status: 'completed', requestedModel: null, requestedEffort: null, servedModel: 'fake/model-default', startedAt: 0, endedAt: 10_000,
  inputTokens: 100, outputTokens: 420, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null, costRuns: 1, costFinal: true, ...p,
});

describe('run footer', () => {
  it('rate: output tokens over the run, only past one second and for a dated run', () => {
    expect(tokensPerSecond(r({}))).toBe(42);
    expect(tokensPerSecond(r({ endedAt: 900 }))).toBeNull();
    expect(tokensPerSecond(r({ outputTokens: null }))).toBeNull();
    expect(tokensPerSecond(r({ status: 'interrupted' }))).toBeNull();
    expect(tokensPerSecond(r({ endedAt: null }))).toBeNull();
  });

  it('fallback only when a model was asked and another one served', () => {
    expect(fallback(r({ requestedModel: 'openrouter/fake/model-default' }))).toBe(false);
    expect(fallback(r({ requestedModel: 'fake/model-pro', servedModel: 'fake/model-fallback' }))).toBe(true);
    expect(fallback(r({ requestedModel: null, servedModel: 'fake/model-fallback' }))).toBe(false);
  });

  it('simple line: duration and cost; the full one adds model, tokens, rate and cache', () => {
    const run = r({ costUsd: 0.0123, cacheReadTokens: 75 });
    const simple = footerItems(run, false);
    expect(simple).toHaveLength(2);
    expect(simple.join(' ')).not.toContain('model-default');
    const full = footerItems(run, true);
    expect(full[0]).toBe('model-default');
    expect(full.join(' · ')).toContain('→');
    expect(full.join(' · ')).toContain('Cache');
    expect(full.length).toBeGreaterThan(simple.length);
  });
  it('simple line still says when a fallback model answered', () => {
    expect(footerItems(r({ requestedModel: 'fake/model-pro', servedModel: 'fake/model-fallback' }), false)[0]).toBe('model-fallback (secours)');
  });
});
