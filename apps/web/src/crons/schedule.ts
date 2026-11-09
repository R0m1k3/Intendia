// Cron schedules in plain French. Hours are Hermes's (its configured time zone), never the browser's.
import type { CronSchedule } from '../api';

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
  { kind: 'daily', label: 'Chaque jour' },
  { kind: 'weekdays', label: 'Du lundi au vendredi' },
  { kind: 'weekly', label: 'Chaque semaine' },
  { kind: 'monthly', label: 'Chaque mois' },
  { kind: 'hours', label: 'Toutes les N heures' },
  { kind: 'minutes', label: 'Toutes les N minutes' },
  { kind: 'once', label: 'Une seule fois' },
  { kind: 'cron', label: 'Expression cron' },
];

/** Sunday = 0, as in cron. */
export const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

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
    case 'minutes': return int(f.n, 1, 1440) ? null : 'Entre 1 et 1440 minutes';
    case 'hours': return int(f.n, 1, 168) ? null : 'Entre 1 et 168 heures';
    case 'weekly': return !int(f.day, 0, 6) ? 'Jour invalide' : TIME_RE.test(f.time) ? null : 'Heure invalide (HH:MM)';
    case 'monthly': return !int(f.day, 1, 31) ? 'Jour entre 1 et 31' : TIME_RE.test(f.time) ? null : 'Heure invalide (HH:MM)';
    case 'once': return !DATE_RE.test(f.date) ? 'Date invalide' : TIME_RE.test(f.time) ? null : 'Heure invalide (HH:MM)';
    case 'cron': return f.expr.trim().split(/\s+/).length === 5 ? null : 'Une expression cron a 5 champs : minute heure jour mois jour-de-semaine';
    default: return TIME_RE.test(f.time) ? null : 'Heure invalide (HH:MM)';
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
  return m === 0 ? `${h} h` : `${h} h ${pad(m)}`;
}

export function frDate(p: { y: number; mo: number; d: number }, withYear = true): string {
  return `${p.d === 1 ? '1er' : p.d} ${MONTHS[p.mo - 1]}${withYear ? ` ${p.y}` : ''}`;
}

/** Plain French for a form. */
export function describeForm(f: ScheduleForm): string {
  switch (f.kind) {
    case 'minutes': return f.n === 1 ? 'Toutes les minutes' : `Toutes les ${f.n} minutes`;
    case 'hours': return f.n === 1 ? 'Toutes les heures' : `Toutes les ${f.n} heures`;
    case 'daily': return `Tous les jours à ${frTime(f.time)}`;
    case 'weekdays': return `Du lundi au vendredi à ${frTime(f.time)}`;
    case 'weekly': return `Chaque ${DAYS[f.day]} à ${frTime(f.time)}`;
    case 'monthly': return `Le ${f.day === 1 ? '1er' : f.day} de chaque mois à ${frTime(f.time)}`;
    case 'once': {
      const [y, mo, d] = f.date.split('-').map(Number);
      return `Une fois, le ${frDate({ y: y!, mo: mo!, d: d! })} à ${frTime(f.time)}`;
    }
    case 'cron': return `Expression cron ${f.expr}`;
  }
}

/** Plain French for a Hermes schedule; Hermes's own text when no simple form matches. */
export function describe(s: CronSchedule): string {
  const f = fromSchedule(s);
  if (f.kind === 'cron') return s.display || (s.expr ? `Expression cron ${s.expr}` : 'Planning inconnu');
  return describeForm(f);
}

/** "UTC+01:00" from an ISO date written by Hermes, or null. */
export function offsetOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return null;
  return m[1] === 'Z' || m[1] === '+00:00' ? 'UTC' : `UTC${m[1]}`;
}

/** "demain à 9 h", "le 12 nov. à 8 h 30", in Hermes's offset; `now` for tests. */
export function whenFr(iso: string | null, now = Date.now()): string {
  if (!iso) return '-';
  const p = hermesParts(iso);
  if (!p) return iso;
  const off = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  const offMin = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0;
  const local = new Date(now + offMin * 60_000); // now, as Hermes's wall clock (read in UTC)
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const day = Date.UTC(p.y, p.mo - 1, p.d);
  const diff = Math.round((day - today) / 86_400_000);
  const t = frTime(p.time);
  if (diff === 0) return `aujourd’hui à ${t}`;
  if (diff === 1) return `demain à ${t}`;
  if (diff === -1) return `hier à ${t}`;
  return `le ${frDate(p, p.y !== local.getUTCFullYear())} à ${t}`;
}
