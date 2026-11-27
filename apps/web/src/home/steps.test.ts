import { describe, expect, it } from 'vitest';
import { firstSteps, showSteps } from './steps';

describe('first steps', () => {
  it('ticks what exists', () => {
    const s = firstSteps({ model: true, folders: 2, sessions: 0, schedules: 0 });
    expect(s.map((x) => [x.key, x.done])).toEqual([['model', true], ['folder', true], ['request', false], ['schedule', false]]);
  });
  it('shows while something is left, never before the facts are known, never once closed', () => {
    expect(showSteps({ model: true, folders: 1, sessions: 0, schedules: 0 }, false)).toBe(true);
    expect(showSteps({ model: true, folders: 1, sessions: 3, schedules: 1 }, false)).toBe(false);
    expect(showSteps({ model: null, folders: 1, sessions: 0, schedules: 0 }, false)).toBe(false);
    expect(showSteps({ model: true, folders: 1, sessions: 0, schedules: null }, false)).toBe(false);
    expect(showSteps({ model: false, folders: 1, sessions: 0, schedules: 0 }, true)).toBe(false);
  });
});
