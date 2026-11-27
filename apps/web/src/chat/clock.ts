import { locale } from '../i18n';

/** Time of day of a Unix timestamp (seconds), in the language of the interface; '' without one. */
export function clock(ts: number | null, seconds = false): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
}
