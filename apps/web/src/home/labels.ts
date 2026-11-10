import type { RecentSession } from '../api';

export type RecentFilter = 'all' | 'intendia' | 'telegram' | 'cron';

export const FILTERS: { key: RecentFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'intendia', label: 'Intendia' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'cron', label: 'Crons' },
];

const KNOWN: Record<string, string> = { intendia: 'Intendia', telegram: 'Telegram', cron: 'Cron', cli: 'CLI', api_server: 'API' };

/** Tag of a session's source; unknown values get a capital, a missing one reads "Hermes". */
export function sourceLabel(source: string | null): string {
  if (!source) return 'Hermes';
  return KNOWN[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function filterRecent(list: RecentSession[], f: RecentFilter, max = 7): RecentSession[] {
  return (f === 'all' ? list : list.filter((s) => s.source === f)).slice(0, max);
}
