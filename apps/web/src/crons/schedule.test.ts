import { describe, expect, it } from 'vitest';
import type { CronSchedule } from '../api';
import { describe as describeSchedule, describeForm, fromSchedule, offsetOf, toSchedule, validate, whenFr, type ScheduleForm } from './schedule';

const sched = (s: Partial<CronSchedule>): CronSchedule => ({ kind: 'cron', minutes: null, expr: null, runAt: null, display: null, ...s });

/** What Hermes answers for a schedule string (shapes checked on 0.23.0). */
function hermes(str: string): CronSchedule {
  const every = /^every (\d+)([mh])$/.exec(str);
  if (every) return sched({ kind: 'interval', minutes: Number(every[1]) * (every[2] === 'h' ? 60 : 1) });
  if (/^\d{4}-/.test(str)) return sched({ kind: 'once', runAt: `${str}+01:00` });
  return sched({ kind: 'cron', expr: str });
}

describe('schedule forms', () => {
  const cases: [ScheduleForm, string, string][] = [
    [{ kind: 'minutes', n: 30 }, 'every 30m', 'Toutes les 30 minutes'],
    [{ kind: 'hours', n: 2 }, 'every 2h', 'Toutes les 2 heures'],
    [{ kind: 'hours', n: 1 }, 'every 1h', 'Toutes les heures'],
    [{ kind: 'daily', time: '08:30' }, '30 8 * * *', 'Tous les jours à 8 h 30'],
    [{ kind: 'weekdays', time: '09:00' }, '0 9 * * 1-5', 'Du lundi au vendredi à 9 h'],
    [{ kind: 'weekly', day: 1, time: '07:05' }, '5 7 * * 1', 'Chaque lundi à 7 h 05'],
    [{ kind: 'weekly', day: 0, time: '20:00' }, '0 20 * * 0', 'Chaque dimanche à 20 h'],
    [{ kind: 'monthly', day: 1, time: '06:00' }, '0 6 1 * *', 'Le 1er de chaque mois à 6 h'],
    [{ kind: 'once', date: '2026-11-12', time: '08:30' }, '2026-11-12T08:30:00', 'Une fois, le 12 nov. 2026 à 8 h 30'],
  ];
  it.each(cases)('%o → %s → back, described in French', (form, str, fr) => {
    expect(validate(form)).toBeNull();
    expect(toSchedule(form)).toBe(str);
    expect(fromSchedule(hermes(str))).toEqual(form);
    expect(describeForm(form)).toBe(fr);
    expect(describeSchedule(hermes(str))).toBe(fr);
  });

  it('90 minutes stays in minutes; sunday written 7 reads as sunday', () => {
    expect(fromSchedule(hermes('every 90m'))).toEqual({ kind: 'minutes', n: 90 });
    expect(fromSchedule(hermes('0 20 * * 7'))).toEqual({ kind: 'weekly', day: 0, time: '20:00' });
  });

  it('other expressions reopen in expression mode and show Hermes text', () => {
    expect(fromSchedule(hermes('*/15 9-17 * * 1-5'))).toEqual({ kind: 'cron', expr: '*/15 9-17 * * 1-5' });
    expect(describeSchedule(sched({ expr: '*/15 9-17 * * 1-5', display: '*/15 9-17 * * 1-5' }))).toBe('*/15 9-17 * * 1-5');
    expect(describeSchedule(sched({ kind: 'unknown', display: 'every monday 9am' }))).toBe('every monday 9am');
    expect(toSchedule({ kind: 'cron', expr: '  0  9 * *   * ' })).toBe('0 9 * * *');
  });

  it('validates inputs', () => {
    expect(validate({ kind: 'minutes', n: 0 })).not.toBeNull();
    expect(validate({ kind: 'hours', n: 1.5 })).not.toBeNull();
    expect(validate({ kind: 'daily', time: '24:00' })).not.toBeNull();
    expect(validate({ kind: 'monthly', day: 32, time: '08:00' })).not.toBeNull();
    expect(validate({ kind: 'cron', expr: '0 9 * *' })).not.toBeNull();
  });
});

describe('Hermes dates', () => {
  it('reads the offset', () => {
    expect(offsetOf('2026-11-10T09:00:00+01:00')).toBe('UTC+01:00');
    expect(offsetOf('2026-11-10T09:00:00+00:00')).toBe('UTC');
    expect(offsetOf('2026-11-10T09:00:00')).toBeNull();
  });

  it('says today / tomorrow / a date, in Hermes wall-clock time', () => {
    const now = Date.parse('2026-11-09T22:30:00Z'); // 23:30 at +01:00
    expect(whenFr('2026-11-09T23:45:00+01:00', now)).toBe('aujourd’hui à 23 h 45');
    expect(whenFr('2026-11-10T09:00:00+01:00', now)).toBe('demain à 9 h');
    expect(whenFr('2026-11-20T08:30:00+01:00', now)).toBe('le 20 nov. à 8 h 30');
    expect(whenFr('2027-01-02T08:30:00+01:00', now)).toBe('le 2 janv. 2027 à 8 h 30');
    expect(whenFr(null, now)).toBe('-');
  });
});
