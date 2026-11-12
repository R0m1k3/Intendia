/**
 * The first message sent from the home page, handed to the session page it opens so it shows at once (Hermes'
 * history may not hold it yet). In memory only: a reload starts without it, nothing is ever sent from here.
 */
export interface Handoff { inst: string; sessionId: string; runId: string; text: string; ts: number }

let pending: Handoff | null = null;

export function setHandoff(h: Handoff): void {
  pending = h;
}

/**
 * Text to put in the composer of a session page about to open (undo of the last exchange, a send that failed after
 * a replacement). In memory only, read once.
 */
export interface Draft { inst: string; sessionId: string; text: string; error?: string }
let draft: Draft | null = null;

export function setDraft(d: Draft): void {
  draft = d;
}

export function takeDraft(inst: string, sessionId: string): Draft | null {
  const d = draft;
  if (!d || d.inst !== inst || d.sessionId !== sessionId) return null;
  draft = null;
  return d;
}

/** The message of this run, read once. */
export function takeHandoff(inst: string, sessionId: string, runId: string): Handoff | null {
  const h = pending;
  if (!h || h.inst !== inst || h.sessionId !== sessionId || h.runId !== runId) return null;
  pending = null;
  return h;
}
