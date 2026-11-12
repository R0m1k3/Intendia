import type { AppDeps } from '../app.js';
import type { CompatService } from '../compat/service.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import type { SessionContext } from './service.js';

/** Hermes 0.23 keeps titles unique (like its own « #2 » lineage): the other numbers tried before giving up. */
const MAX_NUMBER = 20;
const NUMBERED = /^(.*?) #(\d+)$/;

/** Titles to try, Hermes' way: the title, then « base #2 », « base #3 »… */
export function titleCandidates(title: string): string[] {
  const base = NUMBERED.exec(title)?.[1] ?? title;
  return [title, ...Array.from({ length: MAX_NUMBER - 1 }, (_, i) => `${base} #${i + 2}`).filter((t) => t !== title)];
}

const inUse = (err: unknown) => err instanceof HermesError && err.detail.status === 400 && /already in use|invalid_title/.test(err.detail.body ?? '');

/**
 * Sends the title to Hermes so Telegram or the CLI show the same. Taken by another session (Hermes refuses a
 * duplicate) → the next free « #N », as Hermes names its own; the title in Intendia stays as given. Other failures
 * are ignored: the session may not exist at Hermes yet, or the route may be missing.
 */
export async function pushHermesTitle(compat: CompatService, instanceId: string, profile: string, sessionId: string, title: string | null, timeoutMs?: number): Promise<void> {
  if (!title) return;
  for (const candidate of titleCandidates(title)) {
    try {
      await callOp(compat.http(instanceId), compat.get(instanceId), 'sessions', 'update', {
        params: { session_id: sessionId }, body: { title: candidate }, profile, ...(timeoutMs ? { timeoutMs } : {}),
      });
      return;
    } catch (err) {
      if (!inUse(err)) return;
    }
  }
}

export async function pushTitle(deps: Pick<AppDeps, 'compat'>, ctx: SessionContext, title: string | null, timeoutMs?: number): Promise<void> {
  await pushHermesTitle(deps.compat, ctx.instance.id, ctx.profile, ctx.session.id, title, timeoutMs);
}
