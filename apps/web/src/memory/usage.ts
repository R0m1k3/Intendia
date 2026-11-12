import type { MemoryUsage } from '../api';

const nf = new Intl.NumberFormat('fr-FR');

/**
 * Fill of a memory file. Hermes gives the size in bytes and counts its limit in characters: an accented text is a
 * little over-counted, so the label says "environ".
 */
export function usageLabel(u: MemoryUsage | null): string {
  if (!u) return 'taille inconnue';
  return `environ ${nf.format(u.bytes)} / ${nf.format(u.limit)} caractères`;
}

/** 0-100 for the bar; over 100 when the file is past its limit (Hermes refuses then any longer edit). */
export function usagePercent(u: MemoryUsage | null): number | null {
  if (!u || u.limit <= 0) return null;
  return Math.round((u.bytes / u.limit) * 100);
}
