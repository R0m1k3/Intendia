import type { Cron, CronInput } from '../api';
import { t } from '../i18n';

/** The "Options avancées" of a cron as the form holds them (strings for the inputs). */
export interface AdvancedForm {
  /** '' = forever, else a whole number of runs */
  repeat: string;
  /** '' = Hermes' zone */
  timezone: string;
  /** none checked = every toolset (never sent as []: for Hermes an empty list allows no tool) */
  toolsets: string[];
  catchUp: 'default' | 'yes' | 'no';
  /** '' = Hermes' default, minutes */
  grace: string;
  contextFrom: string[];
}

type AdvancedInput = Pick<CronInput, 'repeat' | 'timezone' | 'enabledToolsets' | 'catchUp' | 'graceMinutes' | 'contextFrom'>;

export function advancedOf(cron: Cron | null): AdvancedForm {
  return {
    repeat: cron?.repeat ? String(cron.repeat) : '',
    timezone: cron?.timezone ?? '',
    toolsets: cron?.enabledToolsets ?? [],
    catchUp: cron?.catchUp === true ? 'yes' : cron?.catchUp === false ? 'no' : 'default',
    grace: cron?.graceMinutes !== null && cron?.graceMinutes !== undefined ? String(cron.graceMinutes) : '',
    contextFrom: cron?.contextFrom ?? [],
  };
}

const intIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;
const TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;

/** The first problem of the form, or null. */
export function advancedError(f: AdvancedForm): string | null {
  if (f.repeat.trim() && !intIn(f.repeat, 1, 100_000)) return t('Répétition : un nombre entier de 1 à 100 000 (vide = toujours)');
  if (f.timezone.trim() && !TZ_RE.test(f.timezone.trim())) return t('Fuseau horaire inconnu (exemple : Europe/Paris)');
  if (f.grace.trim() && !intIn(f.grace, 0, 10_080)) return t('Délai de grâce : des minutes, de 0 à 10 080');
  if (f.contextFrom.length > 10) return t('Contexte : 10 crons au plus');
  return null;
}

function toInput(f: AdvancedForm): Required<AdvancedInput> {
  return {
    repeat: f.repeat.trim() ? Number(f.repeat) : 'forever',
    timezone: f.timezone.trim() || null,
    enabledToolsets: f.toolsets.length ? [...f.toolsets].sort() : null,
    catchUp: f.catchUp === 'default' ? null : f.catchUp === 'yes',
    graceMinutes: f.grace.trim() ? Number(f.grace) : null,
    contextFrom: f.contextFrom.length ? f.contextFrom : null,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the request carries. New cron: every field (the server leaves the empty ones out). Edited cron: only the
 * changed fields, so an untouched repeat never restarts Hermes' count and Hermes keeps what Intendia does not show.
 */
export function advancedInput(f: AdvancedForm, initial: AdvancedForm | null): AdvancedInput {
  const next = toInput(f);
  if (!initial) return next;
  const before = toInput(initial);
  const out: AdvancedInput = {};
  for (const k of Object.keys(next) as (keyof AdvancedInput)[]) {
    if (!same(next[k], before[k])) (out as Record<string, unknown>)[k] = next[k];
  }
  return out;
}

/** Number of advanced options set (shown on the folded block). */
export function advancedCount(f: AdvancedForm): number {
  return [f.repeat.trim(), f.timezone.trim(), f.toolsets.length, f.catchUp !== 'default', f.grace.trim(), f.contextFrom.length].filter(Boolean).length;
}
