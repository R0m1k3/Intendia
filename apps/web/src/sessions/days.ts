import { locale, t } from '../i18n';

/** Day of a session in the browser's zone (a session's date is the user's). */
function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Aujourd'hui", "Hier", else "mardi 4 novembre" (with the year when it is not this year's). */
export function dayLabel(at: number, now = Date.now()): string {
  if (!at) return t('Date inconnue');
  if (dayKey(at) === dayKey(now)) return t('Aujourd’hui');
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(at) === dayKey(y.getTime())) return t('Hier');
  const d = new Date(at);
  return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** Consecutive items of the same day in one group, order kept. */
export function groupByDay<T extends { at: number }>(items: T[], now = Date.now()): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.at, now);
    const last = out.at(-1);
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}
