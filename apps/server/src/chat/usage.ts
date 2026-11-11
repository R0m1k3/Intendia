import type { SessionStats } from '../hermes/gateway-ws.js';

/** What the composer's gauge shows. `max`: the context size of the model (HTTP); `exact`: the gateway's own figures. */
export interface SessionUsage {
  max: number | null;
  exact: { used: number; max: number } | null;
  quota: { label: string | null; usedPercent: number; resetsAt: number | null } | null;
}

/**
 * `max` only when the session runs the configured model (Auto, or the same model): another model has its own size.
 * `exact` only when the gateway gives both figures (0 before the agent's first turn, after a restart).
 */
export function toUsage(
  stats: SessionStats | null,
  info: { model: string; effective_context_length?: number | null } | null,
  session: { model: string | null },
): SessionUsage {
  const size = info?.effective_context_length;
  const max = info && typeof size === 'number' && size > 0 && (session.model === null || session.model === info.model) ? size : null;
  const used = stats?.context_tokens;
  const length = stats?.context_length;
  const exact = typeof used === 'number' && typeof length === 'number' && used > 0 && length > 0 ? { used, max: length } : null;
  const g = stats?.plan_gauge;
  const quota = g && typeof g.used_bp === 'number'
    ? { label: g.label ?? null, usedPercent: Math.min(100, Math.max(0, g.used_bp / 100)), resetsAt: typeof g.resets_at_ms === 'number' ? g.resets_at_ms : null }
    : null;
  return { max, exact, quota };
}
