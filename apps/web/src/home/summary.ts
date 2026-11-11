import type { OverviewCron } from '../api';

/** Last-run statuses shown as a failure. */
export const FAILED = new Set(['error', 'delivery_failed']);

export function failedCount(crons: Pick<OverviewCron, 'lastStatus'>[]): number {
  return crons.filter((c) => FAILED.has(c.lastStatus ?? '')).length;
}

export function failureLabel(n: number): string {
  return `${n.toLocaleString('fr-FR')} ${n > 1 ? 'crons' : 'cron'} en échec`;
}
