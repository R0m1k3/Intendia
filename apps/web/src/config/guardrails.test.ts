import { describe, expect, it } from 'vitest';
import { GUARDRAILS, parsePreset } from './guardrails';

const item = (path: string) => GUARDRAILS.items.find((i) => i.path === path);

describe('guardrails', () => {
  it('sends a number for the fields Hermes types string, null when emptied', () => {
    expect(parsePreset(item('agent.run_budget_seconds'), 'text', '300', null)).toEqual({ ok: true, value: 300 });
    expect(parsePreset(item('agent.budget_warning_ratio'), 'text', '0,8', null)).toEqual({ ok: true, value: 0.8 });
    expect(parsePreset(item('agent.run_budget_seconds'), 'number', '', 300)).toEqual({ ok: true, value: null });
    expect(parsePreset(item('agent.run_budget_seconds'), 'text', 'beaucoup', null).ok).toBe(false);
  });
  it('keeps the usual editors elsewhere', () => {
    expect(parsePreset(item('delegation.max_spawn_depth'), 'number', '2', 1)).toEqual({ ok: true, value: 2 });
    expect(parsePreset(item('delegation.max_spawn_depth'), 'number', '', 1).ok).toBe(false);
  });
  it('lists each path once', () => {
    const paths = GUARDRAILS.items.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
