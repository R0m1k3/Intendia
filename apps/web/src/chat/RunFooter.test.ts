import { describe, expect, it } from 'vitest';
import type { RunStat } from '../api';
import { fallback, tokensPerSecond } from './RunFooter';

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
});
