import { describe, expect, it } from 'vitest';
import type { UsageDay } from '../api';
import { fillDays } from './DailyBars';

const day = (d: string, cost: number): UsageDay => ({ day: d, estimatedCost: cost, actualCost: 0, input: 0, output: 0, sessions: 1, apiCalls: 1 });

describe('fillDays', () => {
  it('ends the period today, days without activity at 0', () => {
    const out = fillDays([day('2026-11-08', 1), day('2026-11-10', 2)], 7, new Date(2026, 10, 12, 9));
    expect(out.map((d) => d.day)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
    expect(out.map((d) => d.estimatedCost)).toEqual([0, 0, 1, 0, 2, 0, 0]);
  });

  it('follows Hermes when its day is already tomorrow; empty period still has every day', () => {
    expect(fillDays([day('2026-11-13', 1)], 7, new Date(2026, 10, 12, 23)).at(-1)?.day).toBe('2026-11-13');
    expect(fillDays([], 30, new Date(2026, 10, 12))).toHaveLength(30);
  });
});
