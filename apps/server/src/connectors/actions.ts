import { z } from 'zod';

/** Status of a dashboard background action (`/api/actions/{name}/status`), shared by the skills and config connectors. */
export const ActionStatusSchema = z.looseObject({
  running: z.boolean(),
  exit_code: z.number().nullable(),
  lines: z.array(z.string()),
});

export const KEEP_LINES = 20;
export const LINE_MAX = 300;

/** Lines of the last run only (Hermes appends every run to one log per action name), capped. */
export function lastRunLines(name: string, lines: string[]): { lines: string[]; truncated: boolean } {
  const header = `=== ${name} started`;
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith(header)) { start = i + 1; break; }
  }
  const run = (start >= 0 ? lines.slice(start) : lines).filter((l, i, all) => l !== '' || (i > 0 && i < all.length - 1));
  return { lines: run.slice(-KEEP_LINES).map((l) => (l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l)), truncated: start < 0 };
}
