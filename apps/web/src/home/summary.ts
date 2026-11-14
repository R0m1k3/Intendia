import type { OverviewCron } from '../api';
import { plural } from '../i18n';

/** Last-run statuses shown as a failure. */
export const FAILED = new Set(['error', 'delivery_failed']);

export function failedCount(crons: Pick<OverviewCron, 'lastStatus'>[]): number {
  return crons.filter((c) => FAILED.has(c.lastStatus ?? '')).length;
}

export function failureLabel(n: number): string {
  return plural(n, '{n} cron en échec', '{n} crons en échec');
}
