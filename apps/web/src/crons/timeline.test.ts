import { describe, expect, it } from 'vitest';
import type { CronSchedule } from '../api';
import { dayStart, occurrences, parseCron, type TimelineCron } from './timeline';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const sched = (over: Partial<CronSchedule>): CronSchedule => ({ kind: 'cron', minutes: null, expr: null, runAt: null, display: null, ...over });
const cron = (expr: string, over: Partial<TimelineCron> = {}): TimelineCron => ({ schedule: sched({ expr }), nextRunAt: null, timezone: null, ...over });
const count = (c: TimelineCron, d: string, off = 0) => occurrences(c, day(d), off)?.length ?? null;

describe('occurrences', () => {
  it('every minute, every 5 minutes, daily at 8', () => {
    expect(count({ schedule: sched({ kind: 'interval', minutes: 1 }), nextRunAt: '2026-11-11T13:14:00+00:00', timezone: null }, '2026-11-11')).toBe(1440);
    expect(count(cron('*/5 * * * *'), '2026-11-11')).toBe(288);
    expect(occurrences(cron('0 8 * * *'), day('2026-11-11'), 0)).toEqual([480]);
  });
  it('days of the week, and day of month OR day of week', () => {
    expect(count(cron('0 9 * * mon-fri'), '2026-01-10')).toBe(0); // Saturday
    expect(count(cron('0 9 * * mon-fri'), '2026-01-12')).toBe(1); // Monday
    expect(count(cron('0 9 13 * fri'), '2026-08-13')).toBe(1); // Thursday 13
    expect(count(cron('0 9 13 * fri'), '2026-08-14')).toBe(1); // Friday 14
    expect(count(cron('0 9 13 * fri'), '2026-08-12')).toBe(0); // Wednesday 12
    expect(occurrences(cron('@daily'), day('2026-08-12'), 0)).toEqual([0]);
    expect(count(cron('0 9 * * 7'), '2026-11-15')).toBe(1); // Sunday as 7
  });
  it('interval anchored on the next run, backwards and forwards', () => {
    const c = { schedule: sched({ kind: 'interval', minutes: 90 }), nextRunAt: '2026-11-11T10:30:00+00:00', timezone: null };
    const list = occurrences(c, day('2026-11-11'), 0)!;
    expect(list).toHaveLength(16);
    expect(list).toContain(90);
    expect(list).toContain(22 * 60 + 30);
  });
  it('once, and a cron with its own time zone', () => {
    expect(count({ schedule: sched({ kind: 'once', runAt: '2026-11-10T08:00:00+00:00' }), nextRunAt: null, timezone: null }, '2026-11-11')).toBe(0);
    expect(occurrences(cron('0 8 * * *', { timezone: 'Europe/Paris' }), day('2026-01-15'), 0)).toEqual([420]);
  });
  it('the axis offset moves the runs', () => {
    // axis at UTC+01:00: the day starts at 23:00 UTC the day before; 8:00 on the wall = minute 480
    const start = dayStart(Date.parse('2026-11-11T12:00:00Z'), 60);
    expect(new Date(start).toISOString()).toBe('2026-11-10T23:00:00.000Z');
    expect(occurrences(cron('0 8 * * *'), start, 60)).toEqual([480]);
  });
  it('unreadable forms → null', () => {
    expect(parseCron('@reboot')).toBeNull();
    expect(parseCron('61 * * * *')).toBeNull();
    expect(parseCron('0 9 L * *')).toBeNull();
    expect(occurrences({ schedule: sched({ kind: 'unknown' }), nextRunAt: null, timezone: null }, day('2026-11-11'), 0)).toBeNull();
  });
});
