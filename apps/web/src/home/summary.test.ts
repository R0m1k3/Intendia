import { describe, expect, it } from 'vitest';
import { failedCount, failureLabel } from './summary';

describe('cron summary', () => {
  it('counts error and delivery_failed as failures', () => {
    expect(failedCount([{ lastStatus: 'error' }, { lastStatus: 'delivery_failed' }, { lastStatus: 'ok' }, { lastStatus: null }])).toBe(2);
    expect(failedCount([])).toBe(0);
  });

  it('writes the failure line in French, singular and plural', () => {
    expect(failureLabel(1)).toBe('1 cron en échec');
    expect(failureLabel(3)).toBe('3 crons en échec');
  });
});
