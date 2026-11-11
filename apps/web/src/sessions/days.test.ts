import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from './days';

const NOW = new Date(2026, 10, 11, 15, 0).getTime();
const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();

describe('days', () => {
  it('labels today, yesterday, then the date', () => {
    expect(dayLabel(at(11, 1), NOW)).toBe('Aujourd’hui');
    expect(dayLabel(at(10, 23), NOW)).toBe('Hier');
    expect(dayLabel(at(4), NOW)).toBe('mercredi 4 novembre');
    expect(dayLabel(new Date(2025, 10, 4).getTime(), NOW)).toBe('mardi 4 novembre 2025');
  });
  it('groups consecutive items, order kept', () => {
    const g = groupByDay([{ at: at(11, 12) }, { at: at(11, 9) }, { at: at(10) }, { at: at(4) }], NOW);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Aujourd’hui', 2], ['Hier', 1], ['mercredi 4 novembre', 1]]);
  });
});
