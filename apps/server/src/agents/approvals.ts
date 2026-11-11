import type { CompatService } from '../compat/service.js';
import type { PendingControl } from '../connectors/chat/index.js';
import { streamOp } from '../connectors/runtime.js';
import { readSseFrames, type SseFrame } from '../connectors/sse.js';

/** The question of a run waiting for approval, as read in its events. */
export interface ApprovalQuestion {
  /** `<runId>:<id>`, or `<runId>:seq<frame id>` when Hermes sends no id. */
  key: string;
  requestId: string | null;
  command: string | null;
  description: string | null;
  choices: string[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * The last `approval.request` not followed by its end (same reading as web/src/chat/events.ts). Two formats: with the
 * gateway session authority (Hermes 0.23) `prompt_id` and `approval.settled`, without it `request_id` and
 * `approval.responded`.
 */
export function lastPendingApproval(runId: string, frames: SseFrame[]): ApprovalQuestion | null {
  let pending: ApprovalQuestion | null = null;
  for (const f of frames) {
    const ev = f.data as Record<string, unknown> | null;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.event === 'approval.request') {
      const requestId = str(ev.prompt_id) ?? str(ev.request_id);
      pending = {
        key: `${runId}:${requestId ?? `seq${f.id ?? '?'}`}`,
        requestId,
        command: str(ev.command),
        description: str(ev.description),
        choices: Array.isArray(ev.choices) && ev.choices.length ? ev.choices.map(String) : ['once', 'deny'],
      };
    } else if (ev.event === 'approval.responded' || ev.event === 'approval.settled') {
      pending = null;
    }
  }
  return pending;
}

/** The first approval listed in the run status (`pending_controls`, gateway session authority), or null. */
export function pendingFromStatus(runId: string, controls: PendingControl[]): ApprovalQuestion | null {
  const p = controls.find((c) => c.kind === 'approval' && c.prompt_id);
  if (!p) return null;
  return {
    key: `${runId}:${p.prompt_id}`, requestId: p.prompt_id ?? null, command: p.command ?? null, description: p.description ?? null,
    choices: p.choices?.length ? p.choices.map(String) : ['once', 'deny'],
  };
}

/**
 * Reads the question of a waiting run in its events (replayed from the start). The stream of a waiting run stays
 * open: the reading stops `idleMs` after the last frame, or after `maxMs`. Any failure → null.
 */
export async function readApproval(
  compat: CompatService, instanceId: string, runId: string, profile: string,
  { maxMs = 2000, idleMs = 300 }: { maxMs?: number; idleMs?: number } = {},
): Promise<ApprovalQuestion | null> {
  const abort = new AbortController();
  try {
    const res = await streamOp(compat.http(instanceId), compat.get(instanceId), 'chat', 'runEvents', {
      params: { run_id: runId }, profile, headers: { Accept: 'text/event-stream' }, signal: abort.signal, timeoutMs: maxMs,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream') || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    return lastPendingApproval(runId, await readSseFrames(res, { maxMs, idleMs }));
  } catch {
    return null;
  } finally {
    abort.abort();
  }
}
