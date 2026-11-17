import { describe, expect, it } from 'vitest';
import { pickStatusBar, sinceLabel } from './StatusBars';

describe('pickStatusBar', () => {
  const outage = { since: 0, api: true, dash: true };
  it('one bar at a time, by priority', () => {
    expect(pickStatusBar({ offline: true, serverDown: true, outage })).toBe('offline');
    expect(pickStatusBar({ offline: false, serverDown: true, outage })).toBe('server');
    expect(pickStatusBar({ offline: false, serverDown: false, outage })).toBe('hermes');
    expect(pickStatusBar({ offline: false, serverDown: false, outage: { since: 0, api: false, dash: true } })).toBe('dashboard');
    expect(pickStatusBar({ offline: false, serverDown: false, outage: undefined })).toBeNull();
  });
});

describe('sinceLabel', () => {
  it('time alone today, with the day otherwise', () => {
    const now = new Date(2026, 10, 17, 15, 0);
    expect(sinceLabel(new Date(2026, 10, 17, 14, 5).getTime(), now)).toBe('14:05');
    expect(sinceLabel(new Date(2026, 10, 3, 14, 5).getTime(), now)).toMatch(/^3 nov\.? 14:05$/);
  });
});
