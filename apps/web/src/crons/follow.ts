// "Run now" follow-up. Hermes writes last_run_at only when a run ends, so a change of that value
// means the triggered run is over: no browser/Hermes clock comparison.
import type { Cron, CronRun } from '../api';
import { t } from '../i18n';

export const FOLLOW_INTERVAL_MS = 2_000;
export const FOLLOW_MAX_MS = 10 * 60_000;

export interface FollowSnapshot {
  lastRunAt: string | null;
  runIds: string[];
  /** Browser time of the click, only for the 10-minute cap. */
  startedAt: number;
}

export function snapshot(cron: Cron, runs: CronRun[] | undefined, now = Date.now()): FollowSnapshot {
  return { lastRunAt: cron.lastRunAt, runIds: (runs ?? []).map((r) => r.id), startedAt: now };
}

export function followState(snap: FollowSnapshot, cron: Cron | undefined, runs: CronRun[] | undefined, now = Date.now()) {
  const run = (runs ?? []).find((r) => !snap.runIds.includes(r.id)) ?? null;
  if (cron && cron.lastRunAt !== snap.lastRunAt) return { state: 'done' as const, run };
  if (now - snap.startedAt > FOLLOW_MAX_MS) return { state: 'timeout' as const, run };
  return { state: 'running' as const, run };
}

/** French label of a Hermes last_status. */
export function statusLabel(status: string | null): { label: string; ok: boolean | null } {
  switch (status) {
    case null: return { label: t('Jamais lancé'), ok: null };
    case 'ok': return { label: t('Réussi'), ok: true };
    case 'cancelled': return { label: t('Annulé'), ok: null };
    case 'blocked_config': return { label: t('Bloqué (configuration)'), ok: false };
    case 'delivery_failed': return { label: t('Fait, envoi échoué'), ok: false };
    case 'error': return { label: t('Échec'), ok: false };
    default: return { label: status, ok: false };
  }
}
