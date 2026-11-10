/**
 * Consumption of a chat run, from what Hermes reports (pure functions, see docs/hermes-api-notes.md):
 * - the run status gives `usage` and `runtime` only for completed runs, times in seconds;
 * - the cost exists only per session, cumulated: a run's cost is the difference between two readings.
 */

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = (typeof EFFORTS)[number];

/** A run row is re-costed during this delay after its end (Hermes writes costs from a background queue). */
export const COST_SETTLE_MS = 30_000;

export interface RunStatusFields {
  status: string;
  created_at?: number | null;
  updated_at?: number | null;
  usage?: unknown;
  runtime?: unknown;
}

export interface FinishFields {
  status: string;
  startedAt: number | null;
  endedAt: number;
  servedModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const secToMs = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null);

/** Fields written when a run reaches a terminal status; `now` (ms) stands in for missing Hermes times. */
export function finishFields(s: RunStatusFields, now: number): FinishFields {
  const usage = s.usage && typeof s.usage === 'object' ? (s.usage as Record<string, unknown>) : null;
  // Hermes sends 0 for counters it does not know: no total means no measure at all
  const measured = usage !== null && (num(usage.total_tokens) ?? 0) > 0;
  const runtime = s.runtime && typeof s.runtime === 'object' ? (s.runtime as Record<string, unknown>) : null;
  const served = runtime && typeof runtime.model === 'string' && runtime.model.trim() ? runtime.model : null;
  return {
    status: s.status,
    startedAt: secToMs(s.created_at),
    endedAt: secToMs(s.updated_at) ?? now,
    servedModel: served,
    inputTokens: measured ? num(usage!.input_tokens) : null,
    outputTokens: measured ? num(usage!.output_tokens) : null,
    cacheReadTokens: measured ? num(usage!.cache_read_tokens) : null,
    cacheWriteTokens: measured ? num(usage!.cache_write_tokens) : null,
  };
}

/** One reading of a session's cumulated cost, on the live session (after compression, the continuation). */
export interface CostReading {
  sessionId: string;
  cost: number;
}

/** Cumulated cost of a Hermes session object: actual when known, else estimated, else nothing counted yet. */
export function sessionCost(session: { actual_cost_usd?: unknown; estimated_cost_usd?: unknown }): number {
  const pick = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return pick(session.actual_cost_usd) ?? pick(session.estimated_cost_usd) ?? 0;
}

/**
 * Cost of one run: reading after minus reading before, on the same live session. A changed session means a
 * compression during the run (part of the cost is elsewhere): unknown rather than a wrong figure.
 */
export function runCost(beforeCost: number | null, beforeSessionId: string | null, after: CostReading | null): number | null {
  if (beforeCost === null || beforeSessionId === null || after === null) return null;
  if (after.sessionId !== beforeSessionId) return null;
  const d = after.cost - beforeCost;
  if (d < 0) return null;
  return Math.round(d * 1e6) / 1e6;
}
