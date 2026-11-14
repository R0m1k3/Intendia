import type { MemoryUsage } from '../api';
import { locale, t } from '../i18n';

const nf = new Intl.NumberFormat(locale());

/**
 * Fill of a memory file. Hermes gives the size in bytes and counts its limit in characters: an accented text is a
 * little over-counted, so the label says "environ".
 */
export function usageLabel(u: MemoryUsage | null): string {
  if (!u) return t('taille inconnue');
  return t('environ {used} / {limit} caractères', { used: nf.format(u.bytes), limit: nf.format(u.limit) });
}

/** 0-100 for the bar; over 100 when the file is past its limit (Hermes refuses then any longer edit). */
export function usagePercent(u: MemoryUsage | null): number | null {
  if (!u || u.limit <= 0) return null;
  return Math.round((u.bytes / u.limit) * 100);
}
