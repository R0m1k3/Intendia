import { sign } from './crypto.js';

/**
 * Freshness check of a text edited in the browser (skills, crons, kanban tasks, AGENTS.md): every read gives a
 * `revision` of the raw text, every write sends it back as `base`, and the server refuses (409 `stale`) when the
 * text changed in between. An HMAC keyed by INTENDIA_SECRET, not a plain hash: the browser may see a masked text,
 * and 64 bits of a plain hash of the raw text would let a weak secret be found by brute force.
 */
export type RevisionOf = (text: string) => string;

export function revisions(secret: string): RevisionOf {
  return (text) => sign(secret, text, { purpose: 'revision-v1', encoding: 'hex' }).slice(0, 16);
}

/** Shape of a `base` sent by the browser. */
export const REVISION_RE = /^[0-9a-f]{16}$/;
