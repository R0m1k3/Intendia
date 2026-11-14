// Answer to an approval of a run, shared by the route (a click on the page) and the AutoApprover (« Sans confirmation »).
import { msg } from '../i18n/index.js';
import { RunStatusSchema } from '../connectors/chat/index.js';
import { callOp } from '../connectors/runtime.js';
import type { CompatService } from '../compat/service.js';
import type { SessionContext } from '../workspaces/service.js';
import { readRunStatus } from './history.js';

export const CONTROL_ERRORS = {
  no_pending: msg('Plus rien n’attend votre réponse'),
  ambiguous: msg('Plusieurs demandes en attente : rechargez la page'),
} as const;

export class ApproveError extends Error {
  constructor(readonly code: 'run_gone' | keyof typeof CONTROL_ERRORS, message: string) {
    super(message);
  }
}

/**
 * Body of an answer to an approval (or a question) of a run. With the gateway session authority (Hermes 0.23: the
 * status has an integer `execution_generation`), Hermes wants exactly `{request_id, execution_generation, choice}`
 * (`answer` for a question), the id being one of `pending_controls`: the page's id when it is listed, else the only
 * one of that kind. Without it (API server without authority), `{choice, request_id?}` as before.
 */
export function controlBody(
  kind: 'approval' | 'clarify', raw: unknown, requestId: string | null, value: string,
): { body: Record<string, unknown> } | { code: keyof typeof CONTROL_ERRORS } {
  const field = kind === 'approval' ? 'choice' : 'answer';
  const parsed = RunStatusSchema.safeParse(raw);
  const generation = parsed.success ? parsed.data.execution_generation : null;
  if (typeof generation !== 'number') return { body: { [field]: value, ...(requestId ? { request_id: requestId } : {}) } };
  const pending = (parsed.success ? parsed.data.pending_controls : []).filter((p) => p.kind === kind && p.prompt_id);
  // an id that is no longer pending is refused: never answer another prompt than the one the page showed
  const chosen = requestId ? pending.find((p) => p.prompt_id === requestId) : pending.length === 1 ? pending[0] : undefined;
  if (!chosen) return { code: pending.length && !requestId ? 'ambiguous' : 'no_pending' };
  return { body: { request_id: chosen.prompt_id, execution_generation: chosen.execution_generation ?? generation, [field]: value } };
}

/** Reads the run's status, then answers its approval `requestId` (or the only one pending). */
export async function answerApproval(
  compat: CompatService, ctx: SessionContext, runId: string, choice: 'once' | 'session' | 'always' | 'deny', requestId: string | null,
): Promise<unknown> {
  const s = await readRunStatus(compat, ctx.instance.id, ctx.profile, runId);
  if (s.status === 'unknown') throw new ApproveError('run_gone', msg('Ce run est terminé'));
  const built = controlBody('approval', s.raw, requestId, choice);
  if ('code' in built) throw new ApproveError(built.code, CONTROL_ERRORS[built.code]);
  return callOp(compat.http(ctx.instance.id), compat.get(ctx.instance.id), 'chat', 'approval', { params: { run_id: runId }, profile: ctx.profile, body: built.body });
}
