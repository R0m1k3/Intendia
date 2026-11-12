// "Afficher les heures": time of each thread entry and the gap with the previous dated one. Pure: formatted by Thread.
import type { Entry } from './events';

export interface Stamp {
  /** seconds */
  ts: number;
  /** seconds since the previous dated entry; null for the first one and under 1 s */
  gap: number | null;
}

/** Key of each dated entry → its stamp, in the thread's order (entries without `ts` are left out). */
export function stamps(entries: Entry[]): Map<string, Stamp> {
  const out = new Map<string, Stamp>();
  let prev: number | null = null;
  for (const e of entries) {
    if (e.ts === null || e.ts === undefined) continue;
    const gap = prev === null ? null : e.ts - prev;
    out.set(e.key, { ts: e.ts, gap: gap !== null && gap >= 1 ? gap : null });
    prev = e.ts;
  }
  return out;
}
