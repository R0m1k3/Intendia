import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import type { CompatService } from '../compat/service.js';
import type { SessionContext } from '../workspaces/service.js';
import { delegationInfo, type DelegationInfo } from './delegation.js';

// Messages and run status of an Intendia session, shared by the chat routes, the session actions and exports.

export interface RawMessage {
  id: number;
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_name?: string | null;
  timestamp?: number | null;
  /** "steer": a text given to the agent during a run (POST /v1/runs/{id}/steer) */
  display_kind?: string | null;
  /** not served by the API server of Hermes 0.23; read when a later version does */
  display_metadata?: unknown;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: { name: string; arguments: string }[];
  timestamp: number | null;
  /** given to the agent during a run (reorientation); only when true */
  steer?: true;
  /** role `delegation`: the delivery of background sub-agents (Hermes' `async_delegation_complete` row) */
  delegation?: DelegationInfo;
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('');
  }
  return content == null ? '' : JSON.stringify(content);
}

function toolCalls(raw: unknown): ChatMessage['toolCalls'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const fn = (t as { function?: { name?: unknown; arguments?: unknown } }).function ?? (t as { name?: unknown; arguments?: unknown });
    return { name: String(fn.name ?? '?'), arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) };
  });
}

/**
 * Hermes messages → oldest first, without session_meta nor `hidden` rows (muted notices, compression handoffs).
 * A delivery of background sub-agents becomes Intendia's own role `delegation` (never a message of the user).
 */
export function toChatMessages(data: RawMessage[]): ChatMessage[] {
  return data
    .filter((m) => m.role !== 'session_meta' && m.display_kind !== 'hidden')
    .sort((a, b) => a.id - b.id)
    .map((m): ChatMessage => {
      const content = text(m.content);
      if (m.display_kind === 'async_delegation_complete') {
        return { id: m.id, role: 'delegation', content, toolName: null, toolCalls: [], timestamp: m.timestamp ?? null, delegation: delegationInfo(m.display_metadata, content) };
      }
      return {
        id: m.id, role: m.role, content, toolName: m.tool_name ?? null,
        toolCalls: toolCalls(m.tool_calls), timestamp: m.timestamp ?? null,
        ...(m.display_kind === 'steer' ? { steer: true as const } : {}),
      };
    });
}

export interface RawStatus {
  status: string; session_id?: string | null; created_at?: number; updated_at?: number | null; output?: string | null; error?: string | null;
  usage?: unknown; runtime?: unknown; pending_steer?: unknown;
}

/** Run status; a run Hermes forgot (404) is "unknown", treated as finished. `raw` feeds run_stats. */
export async function readRunStatus(compat: CompatService, instanceId: string, profile: string, runId: string) {
  try {
    const s = await callOp<RawStatus>(compat.http(instanceId), compat.get(instanceId), 'chat', 'runStatus', { params: { run_id: runId }, profile });
    // a reorientation Hermes could not give the agent before the run ended
    const pendingSteer = typeof s.pending_steer === 'string' && s.pending_steer.trim() ? s.pending_steer : null;
    return { status: s.status, createdAt: s.created_at ?? null, output: s.output ?? null, error: s.error ?? null, pendingSteer, raw: s as RawStatus | null };
  } catch (err) {
    if (err instanceof HermesError && err.detail.status === 404) return { status: 'unknown', createdAt: null, output: null, error: null, pendingSteer: null, raw: null };
    throw err;
  }
}

/** Messages and the live session id (after a compression, the continuation); 404 = no message yet. */
export async function readHistory(compat: CompatService, instanceId: string, sessionId: string, profile: string, limit?: number) {
  try {
    const res = await callOp<{ data: RawMessage[]; session_id?: string | null }>(compat.http(instanceId), compat.get(instanceId), 'sessions', 'messages', {
      params: { session_id: sessionId }, profile, ...(limit ? { query: { limit, order: 'latest' } } : {}),
    });
    return { messages: toChatMessages(res.data), liveId: res.session_id || sessionId, exists: true };
  } catch (err) {
    // an Intendia session before its first message does not exist at Hermes yet
    if (err instanceof HermesError && err.detail.status === 404) return { messages: [] as ChatMessage[], liveId: sessionId, exists: false };
    throw err;
  }
}

/**
 * Sends being started (between the request and the run id written): one at a time per session, and a deletion
 * or a move waits for them. Key: `runKey`.
 */
export const startingRuns = new Set<string>();
export const runKey = (instanceId: string, sessionId: string): string => `${instanceId}:${sessionId}`;

/**
 * A run of the session is going on: a send being started, or a last run Hermes does not report as finished
 * (forgotten = finished). Hermes unreachable: the error is thrown (never "not running").
 */
export async function isRunActive(compat: CompatService, ctx: SessionContext): Promise<boolean> {
  if (startingRuns.has(runKey(ctx.instance.id, ctx.session.id))) return true;
  return isLastRunActive(compat, ctx);
}

/**
 * Runs `change` only when no run of the session goes on, with the session reserved meanwhile (in `startingRuns`:
 * a send started during the check is refused). Returns false when a run goes on.
 */
export async function whenIdle(compat: CompatService, ctx: SessionContext, change: () => void | Promise<void>): Promise<boolean> {
  const key = runKey(ctx.instance.id, ctx.session.id);
  if (startingRuns.has(key)) return false;
  startingRuns.add(key);
  try {
    if (await isLastRunActive(compat, ctx)) return false;
    await change();
    return true;
  } finally {
    startingRuns.delete(key);
  }
}

/** The session's last run is not reported as finished by Hermes (forgotten = finished). */
async function isLastRunActive(compat: CompatService, ctx: SessionContext): Promise<boolean> {
  const runId = ctx.session.lastRunId;
  if (!runId) return false;
  const s = await readRunStatus(compat, ctx.instance.id, ctx.profile, runId);
  return s.status !== 'unknown' && !TERMINAL_STATUSES.includes(s.status);
}
