/**
 * The first message sent from the home page, handed to the session page it opens so it shows at once (Hermes'
 * history may not hold it yet). In memory only: a reload starts without it, nothing is ever sent from here.
 */
export interface Handoff { inst: string; sessionId: string; runId: string; text: string; ts: number }

let pending: Handoff | null = null;

export function setHandoff(h: Handoff): void {
  pending = h;
}

/** The message of this run, read once. */
export function takeHandoff(inst: string, sessionId: string, runId: string): Handoff | null {
  const h = pending;
  if (!h || h.inst !== inst || h.sessionId !== sessionId || h.runId !== runId) return null;
  pending = null;
  return h;
}
