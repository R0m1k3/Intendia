// Cron schedules in plain French. Hours are Hermes's (its configured time zone), never the browser's.
import type { CronSchedule } from '../api';
import { locale, t } from '../i18n';

export type ScheduleForm =
  | { kind: 'minutes'; n: number }
  | { kind: 'hours'; n: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; day: number; time: string }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'once'; date: string; time: string }
  | { kind: 'cron'; expr: string };

export const FORM_KINDS: { kind: ScheduleForm['kind']; label: string }[] = [
  { kind: 'daily', label: t('Chaque jour') },
  { kind: 'weekdays', label: t('Du lundi au vendredi') },
  { kind: 'weekly', label: t('Chaque semaine') },
  { kind: 'monthly', label: t('Chaque mois') },
  { kind: 'hours', label: t('Toutes les N heures') },
  { kind: 'minutes', label: t('Toutes les N minutes') },
  { kind: 'once', label: t('Une seule fois') },
  { kind: 'cron', label: t('Expression cron') },
];

/** Sunday = 0, as in cron. */
export const DAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i))));
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, i, 1))));

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultForm(kind: ScheduleForm['kind'] = 'daily'): ScheduleForm {
  switch (kind) {
    case 'minutes': return { kind, n: 30 };
    case 'hours': return { kind, n: 2 };
    case 'weekly': return { kind, day: 1, time: '08:00' };
    case 'monthly': return { kind, day: 1, time: '08:00' };
    case 'once': return { kind, date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), time: '08:00' };
    case 'cron': return { kind, expr: '0 8 * * *' };
    default: return { kind, time: '08:00' };
  }
}

/** Why the form cannot be sent, or null. */
export function validate(f: ScheduleForm): string | null {
  const int = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  switch (f.kind) {
    case 'minutes': return int(f.n, 1, 1440) ? null : t('Entre 1 et 1440 minutes');
    case 'hours': return int(f.n, 1, 168) ? null : t('Entre 1 et 168 heures');
    case 'weekly': return !int(f.day, 0, 6) ? t('Jour invalide') : TIME_RE.test(f.time) ? null : t('Heure invalide (HH:MM)');
    case 'monthly': return !int(f.day, 1, 31) ? t('Jour entre 1 et 31') : TIME_RE.test(f.time) ? null : t('Heure invalide (HH:MM)');
    case 'once': return !DATE_RE.test(f.date) ? t('Date invalide') : TIME_RE.test(f.time) ? null : t('Heure invalide (HH:MM)');
    case 'cron': return f.expr.trim().split(/\s+/).length === 5 ? null : t('Une expression cron a 5 champs : minute heure jour mois jour-de-semaine');
    default: return TIME_RE.test(f.time) ? null : t('Heure invalide (HH:MM)');
  }
}

const hm = (time: string) => {
  const [h, m] = time.split(':');
  return { h: Number(h), m: Number(m) };
};

/** Form → Hermes schedule string (forms Hermes lists itself in its schedule error message). */
export function toSchedule(f: ScheduleForm): string {
  switch (f.kind) {
    case 'minutes': return `every ${f.n}m`;
    case 'hours': return `every ${f.n}h`;
    case 'daily': { const { h, m } = hm(f.time); return `${m} ${h} * * *`; }
    case 'weekdays': { const { h, m } = hm(f.time); return `${m} ${h} * * 1-5`; }
    case 'weekly': { const { h, m } = hm(f.time); return `${m} ${h} * * ${f.day}`; }
    case 'monthly': { const { h, m } = hm(f.time); return `${m} ${h} ${f.day} * *`; }
    case 'once': return `${f.date}T${f.time}:00`;
    case 'cron': return f.expr.trim().split(/\s+/).join(' ');
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function fromExpr(expr: string): ScheduleForm {
  const p = expr.trim().split(/\s+/);
  const num = (s: string | undefined, max: number) => (s !== undefined && /^\d{1,2}$/.test(s) && Number(s) <= max ? Number(s) : null);
  if (p.length === 5) {
    const m = num(p[0], 59);
    const h = num(p[1], 23);
    if (m !== null && h !== null) {
      const time = `${pad(h)}:${pad(m)}`;
      const [, , dom, mon, dow] = p;
      if (mon === '*' && dom === '*' && dow === '*') return { kind: 'daily', time };
      if (mon === '*' && dom === '*' && dow === '1-5') return { kind: 'weekdays', time };
      const d = num(dow, 7);
      if (mon === '*' && dom === '*' && d !== null) return { kind: 'weekly', day: d % 7, time };
      const day = num(dom, 31);
      if (mon === '*' && dow === '*' && day !== null && day >= 1) return { kind: 'monthly', day, time };
    }
  }
  return { kind: 'cron', expr: expr.trim() };
}

/** Parts of an ISO date as written by Hermes (its own offset), without converting to the browser zone. */
export function hermesParts(iso: string): { date: string; time: string; y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]! };
}

/** Hermes schedule → the editor form (expression mode when no simple form matches). */
export function fromSchedule(s: CronSchedule): ScheduleForm {
  if (s.kind === 'interval' && s.minutes) {
    return s.minutes % 60 === 0 && s.minutes >= 60 ? { kind: 'hours', n: s.minutes / 60 } : { kind: 'minutes', n: s.minutes };
  }
  if (s.kind === 'cron' && s.expr) return fromExpr(s.expr);
  if (s.kind === 'once' && s.runAt) {
    const p = hermesParts(s.runAt);
    if (p) return { kind: 'once', date: p.date, time: p.time };
  }
  return { kind: 'cron', expr: s.expr ?? '' };
}

export function frTime(time: string): string {
  const { h, m } = hm(time);
  return m === 0 ? t('{h} h', { h }) : t('{h} h {m}', { h, m: pad(m) });
}

export function frDate(p: { y: number; mo: number; d: number }, withYear = true): string {
  const vars = { d: p.d === 1 ? t('1er') : p.d, month: MONTHS[p.mo - 1]!, year: p.y };
  return withYear ? t('{d} {month} {year}', vars) : t('{d} {month}', vars);
}

/** Plain French for a form. */
export function describeForm(f: ScheduleForm): string {
  switch (f.kind) {
    case 'minutes': return f.n === 1 ? t('Toutes les minutes') : t('Toutes les {n} minutes', { n: f.n });
    case 'hours': return f.n === 1 ? t('Toutes les heures') : t('Toutes les {n} heures', { n: f.n });
    case 'daily': return t('Tous les jours à {time}', { time: frTime(f.time) });
    case 'weekdays': return t('Du lundi au vendredi à {time}', { time: frTime(f.time) });
    case 'weekly': return t('Chaque {day} à {time}', { day: DAYS[f.day]!, time: frTime(f.time) });
    case 'monthly': return f.day === 1 ? t('Le 1er de chaque mois à {time}', { time: frTime(f.time) }) : t('Le {day} de chaque mois à {time}', { day: f.day, time: frTime(f.time) });
    case 'once': {
      const [y, mo, d] = f.date.split('-').map(Number);
      return t('Une fois, le {date} à {time}', { date: frDate({ y: y!, mo: mo!, d: d! }), time: frTime(f.time) });
    }
    case 'cron': return t('Expression cron {expr}', { expr: f.expr });
  }
}

/** Plain French for a Hermes schedule; Hermes's own text when no simple form matches. */
export function describe(s: CronSchedule): string {
  const f = fromSchedule(s);
  if (f.kind === 'cron') return s.display || (s.expr ? t('Expression cron {expr}', { expr: s.expr }) : t('Planning inconnu'));
  return describeForm(f);
}

/** "UTC+01:00" from an ISO date written by Hermes, or null. */
export function offsetOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return null;
  return m[1] === 'Z' || m[1] === '+00:00' ? 'UTC' : `UTC${m[1]}`;
}

/** Days from today to the date of `iso`, both in Hermes's offset (0 = today), with the current year; null if unreadable. */
export function hermesDayDiff(iso: string, now = Date.now()): { diff: number; year: number } | null {
  const p = hermesParts(iso);
  if (!p) return null;
  const off = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const offMin = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0;
  const local = new Date(now + offMin * 60_000); // now, as Hermes's wall clock (read in UTC)
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const day = Date.UTC(p.y, p.mo - 1, p.d);
  return { diff: Math.round((day - today) / 86_400_000), year: local.getUTCFullYear() };
}

/** "demain à 9 h", "le 12 nov. à 8 h 30", in Hermes's offset; `now` for tests. */
export function whenFr(iso: string | null, now = Date.now()): string {
  if (!iso) return '-';
  const p = hermesParts(iso);
  const dd = hermesDayDiff(iso, now);
  if (!p || !dd) return iso;
  const { diff } = dd;
  const time = frTime(p.time);
  if (diff === 0) return t('aujourd’hui à {time}', { time });
  if (diff === 1) return t('demain à {time}', { time });
  if (diff === -1) return t('hier à {time}', { time });
  return t('le {date} à {time}', { date: frDate(p, p.y !== dd.year), time });
}
