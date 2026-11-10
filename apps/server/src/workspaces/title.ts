import type { AppDeps } from '../app.js';
import { callOp } from '../connectors/runtime.js';
import type { SessionContext } from './service.js';

/** Sends the title to Hermes so Telegram or the CLI show the same; failures are ignored. */
export async function pushTitle(deps: Pick<AppDeps, 'compat'>, ctx: SessionContext, title: string | null, timeoutMs?: number): Promise<void> {
  if (!title) return;
  try {
    await callOp(deps.compat.http(ctx.instance.id), deps.compat.get(ctx.instance.id), 'sessions', 'update', {
      params: { session_id: ctx.session.id }, body: { title }, profile: ctx.profile, ...(timeoutMs ? { timeoutMs } : {}),
    });
  } catch {
    // the session may not exist at Hermes yet, or the route may be missing: the local title stays right
  }
}
