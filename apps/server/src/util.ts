/** A non-null, non-array object (a parsed JSON or YAML mapping). */
export const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));
