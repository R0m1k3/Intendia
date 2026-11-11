// Runs of a day, computed from the schedule, on an axis in Hermes's time (never the browser's: see schedule.ts).
import type { CronSchedule } from '../api';

export const DAY_MIN = 1440;
const MIN = 60_000;

export interface CronFields {
  minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>;
  /** Day of month and day of week both restricted: either one is enough (croniter's rule). */
  dayOr: boolean;
  domAny: boolean;
  dowAny: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
};

function field(text: string, min: number, max: number, names?: string[], nameBase = 0): Set<number> | null {
  const value = (v: string): number | null => {
    const lower = v.toLowerCase();
    if (names) {
      const i = names.indexOf(lower);
      if (i >= 0) return i + nameBase;
    }
    if (!/^\d+$/.test(v)) return null;
    return Number(v);
  };
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^([^/]+)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let lo: number;
    let hi: number;
    if (m[1] === '*') [lo, hi] = [min, max];
    else {
      const [a, b] = m[1]!.split('-');
      const va = value(a!);
      if (va === null) return null;
      const vb = b === undefined ? (m[2] === undefined ? va : max) : value(b);
      if (vb === null || m[1]!.split('-').length > 2) return null;
      [lo, hi] = [va, vb];
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** A 5-field cron expression (names, ranges, steps, lists, @aliases); any other form → null. */
export function parseCron(expr: string): CronFields | null {
  const src = ALIASES[expr.trim().toLowerCase()] ?? expr.trim();
  const p = src.split(/\s+/);
  if (p.length !== 5) return null;
  const minute = field(p[0]!, 0, 59);
  const hour = field(p[1]!, 0, 23);
  const dom = field(p[2]!, 1, 31);
  const month = field(p[3]!, 1, 12, MONTHS, 1);
  const dow = field(p[4]!, 0, 7, DOWS, 0);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.has(7)) dow.add(0);
  const domAny = p[2]!.startsWith('*');
  const dowAny = p[4]!.startsWith('*');
  return { minute, hour, dom, month, dow, domAny, dowAny, dayOr: !domAny && !dowAny };
}

/** Wall clock parts of an instant at a fixed offset (minutes). */
function wallAt(ms: number, offsetMin: number) {
  const d = new Date(ms + offsetMin * MIN);
  return { mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

function matches(f: CronFields, w: ReturnType<typeof wallAt>): boolean {
  if (!f.minute.has(w.mi) || !f.hour.has(w.h) || !f.month.has(w.mo)) return false;
  const domOk = f.dom.has(w.d);
  const dowOk = f.dow.has(w.dow);
  return f.dayOr ? domOk || dowOk : domOk && dowOk;
}

/** Offset (minutes) written at the end of an ISO date; `Z` = 0; none → null. */
export function offsetMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  if (/Z$/.test(iso)) return 0;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

/** Start (ms) of the axis day containing `now`, at the axis offset. */
export function dayStart(now: number, axisOffset: number): number {
  const wall = now + axisOffset * MIN;
  return wall - (((wall % 86_400_000) + 86_400_000) % 86_400_000) - axisOffset * MIN;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();
/** Offset (minutes) of an IANA zone at an instant; null for an unknown zone. */
export function zoneOffset(zone: string, ms: number): number | null {
  if (!formatters.has(zone)) {
    try {
      formatters.set(zone, new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
      }));
    } catch {
      formatters.set(zone, null);
    }
  }
  const f = formatters.get(zone);
  if (!f) return null;
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
  return Math.round((wall - Math.floor(ms / MIN) * MIN) / MIN);
}

export interface TimelineCron { schedule: CronSchedule; nextRunAt: string | null; timezone: string | null }

/**
 * Minutes of the axis day (0–1439) when the cron runs, at most 1 440; null when the schedule cannot be read.
 * `day` = start of the day (ms, see `dayStart`), `axisOffset` = Hermes's offset (minutes).
 */
export function occurrences(cron: TimelineCron, day: number, axisOffset: number): number[] | null {
  const s = cron.schedule;
  const end = day + DAY_MIN * MIN;
  if (s.kind === 'interval') {
    if (!s.minutes || s.minutes < 1) return null;
    const step = s.minutes * MIN;
    const anchor = cron.nextRunAt ? Date.parse(cron.nextRunAt) : day;
    if (Number.isNaN(anchor)) return null;
    const out: number[] = [];
    for (let t = anchor + Math.ceil((day - anchor) / step) * step; t < end && out.length < DAY_MIN; t += step) out.push(Math.floor((t - day) / MIN));
    return out;
  }
  if (s.kind === 'once') {
    const t = s.runAt ? Date.parse(s.runAt) : Number.NaN;
    if (Number.isNaN(t)) return null;
    return t >= day && t < end ? [Math.floor((t - day) / MIN)] : [];
  }
  if (s.kind === 'cron') {
    const f = s.expr ? parseCron(s.expr) : null;
    if (!f) return null;
    // the cron's wall clock: its own zone (offset read once per hour), else the axis
    const fixed = cron.timezone ? null : axisOffset;
    const fallback = offsetMinutes(cron.nextRunAt) ?? axisOffset;
    const out: number[] = [];
    let off = axisOffset;
    for (let m = 0; m < DAY_MIN; m++) {
      const t = day + m * MIN;
      if (fixed === null && m % 60 === 0) off = zoneOffset(cron.timezone!, t) ?? fallback;
      if (matches(f, wallAt(t, fixed ?? off))) out.push(m);
    }
    return out;
  }
  return null;
}

/** "13:14" for a minute of the axis. */
export const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
