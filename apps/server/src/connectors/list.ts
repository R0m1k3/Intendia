import { z } from 'zod';

/** At most one log line per label in this window. */
export const DROP_LOG_MS = 600_000;
const lastDropLog = new Map<string, number>();

/** For tests: forget when each label last logged. */
export function resetDropLog(): void {
  lastDropLog.clear();
}

/**
 * A read-only list from Hermes that keeps its valid items: one item in an unexpected shape no longer fails the
 * whole list. Dropped items are logged (`[intendia] <label>: …`, once per label every 10 min). A non-empty list
 * with no valid item is still a schema error, so a compat probe never says "ok" for a list it cannot read.
 * Never for lists copied back to Hermes (session export / import): those stay `z.array`.
 */
export function tolerantArray<T extends z.ZodType>(item: T, label: string) {
  return z.array(z.unknown()).transform((arr, ctx): z.output<T>[] => {
    const kept: z.output<T>[] = [];
    for (const value of arr) {
      const res = item.safeParse(value);
      if (res.success) kept.push(res.data);
    }
    if (arr.length > 0 && kept.length === 0) {
      ctx.addIssue({ code: 'custom', message: `${label}: no valid item`, input: arr });
      return z.NEVER;
    }
    const dropped = arr.length - kept.length;
    if (dropped > 0) {
      const now = Date.now();
      const last = lastDropLog.get(label);
      if (last === undefined || now - last >= DROP_LOG_MS) {
        lastDropLog.set(label, now);
        console.warn(`[intendia] ${label}: ${dropped} élément(s) ignoré(s) sur ${arr.length}`);
      }
    }
    return kept;
  });
}
