import { describe, expect, it } from 'vitest';
import type { Cron } from '../api';
import { advancedCount, advancedError, advancedInput, advancedOf } from './advanced';

const cron = (over: Partial<Cron>): Cron => ({
  repeat: null, repeatCompleted: 0, timezone: null, enabledToolsets: null, catchUp: null, graceMinutes: null, contextFrom: [], ...over,
} as Cron);

describe('cron advanced options', () => {
  it('a new cron sends every field; empty = Hermes defaults', () => {
    expect(advancedInput(advancedOf(null), null)).toEqual({
      repeat: 'forever', timezone: null, enabledToolsets: null, catchUp: null, graceMinutes: null, contextFrom: null,
    });
    const f = { ...advancedOf(null), repeat: '3', timezone: 'Europe/Paris', toolsets: ['web', 'file'], catchUp: 'no' as const, grace: '0', contextFrom: ['abc'] };
    expect(advancedInput(f, null)).toEqual({
      repeat: 3, timezone: 'Europe/Paris', enabledToolsets: ['file', 'web'], catchUp: false, graceMinutes: 0, contextFrom: ['abc'],
    });
  });

  it('an edit sends only what changed; emptied = null or forever; never []', () => {
    const initial = advancedOf(cron({ repeat: 5, repeatCompleted: 2, timezone: 'UTC', enabledToolsets: ['web'], catchUp: true, graceMinutes: 10, contextFrom: ['a'] }));
    expect(initial).toEqual({ repeat: '5', timezone: 'UTC', toolsets: ['web'], catchUp: 'yes', grace: '10', contextFrom: ['a'] });
    expect(advancedInput(initial, initial)).toEqual({});
    expect(advancedInput({ ...initial, timezone: 'Europe/Paris' }, initial)).toEqual({ timezone: 'Europe/Paris' });
    expect(advancedInput({ repeat: '', timezone: '', toolsets: [], catchUp: 'default', grace: '', contextFrom: [] }, initial)).toEqual({
      repeat: 'forever', timezone: null, enabledToolsets: null, catchUp: null, graceMinutes: null, contextFrom: null,
    });
    // same toolsets in another order: unchanged
    const two = advancedOf(cron({ enabledToolsets: ['web', 'file'] }));
    expect(advancedInput({ ...two, toolsets: ['file', 'web'] }, two)).toEqual({});
  });

  it('checks the inputs', () => {
    const f = advancedOf(null);
    expect(advancedError(f)).toBeNull();
    expect(advancedError({ ...f, repeat: '0' })).toMatch(/Répétition/);
    expect(advancedError({ ...f, repeat: '2.5' })).toMatch(/Répétition/);
    expect(advancedError({ ...f, timezone: 'pas une zone' })).toMatch(/Fuseau/);
    expect(advancedError({ ...f, grace: '-1' })).toMatch(/grâce/);
    expect(advancedCount({ ...f, repeat: '2', catchUp: 'no' })).toBe(2);
  });
});
