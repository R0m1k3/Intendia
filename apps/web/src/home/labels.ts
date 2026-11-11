import type { RecentSession } from '../api';

export type RecentFilter = 'all' | 'intendia' | 'cli' | 'telegram' | 'discord' | 'cron' | 'kanban';

export const FILTERS: { key: RecentFilter; label: string }[] = [
  { key: 'all', label: 'Toutes' },
  { key: 'intendia', label: 'Intendia' },
  { key: 'cli', label: 'CLI' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'discord', label: 'Discord' },
  { key: 'cron', label: 'Crons' },
  { key: 'kanban', label: 'Kanban' },
];

/** The home page keeps its four filters. */
export const HOME_FILTERS = FILTERS.filter((f) => ['all', 'intendia', 'telegram', 'cron'].includes(f.key));

/** Hermes stores CLI, TUI and desktop sessions as `local` (older ones `cli`). */
const matches = (source: string | null, f: RecentFilter): boolean => (f === 'cli' ? source === 'cli' || source === 'local' : source === f);

const KNOWN: Record<string, string> = { intendia: 'Intendia', telegram: 'Telegram', cron: 'Cron', cli: 'CLI', local: 'CLI', discord: 'Discord', kanban: 'Kanban', api_server: 'API' };

/** Tag of a session's source; unknown values get a capital, a missing one reads "Hermes". */
export function sourceLabel(source: string | null): string {
  if (!source) return 'Hermes';
  return KNOWN[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function filterRecent(list: RecentSession[], f: RecentFilter, max = 7): RecentSession[] {
  return (f === 'all' ? list : list.filter((s) => matches(s.source, f))).slice(0, max);
}
