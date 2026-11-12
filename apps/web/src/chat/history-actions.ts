import type { Entry } from './events';

// Edit, retry, undo, branch, clear: each is a truncated copy made by the server (POST …/rewrite), cut before a user
// message given by its Hermes row id. Only entries read from Hermes' history carry that id (key `h<id>`): live
// entries and the "not stored" message of a failed run cannot be a cut point.

export type HistoryAction = 'edit' | 'retry' | 'undo' | 'branch' | 'clear';
type UserEntry = Extract<Entry, { kind: 'user' }>;

/** Label of the "Annuler" banner after a replacement. */
export const ACTION_LABEL: Record<Exclude<HistoryAction, 'branch'>, string> = {
  edit: 'Message modifié',
  retry: 'Réponse relancée',
  undo: 'Dernier échange retiré',
  clear: 'Conversation vidée',
};

/** Hermes row id of a history entry, or null (live entry, message not stored). */
export function rowId(key: string): number | null {
  const m = /^h(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

const isPlainUser = (e: Entry): e is UserEntry => e.kind === 'user' && !e.steer;

/** The last user message (reorientations skipped) when Hermes stored it; null otherwise. */
export function lastUser(entries: Entry[]): UserEntry | null {
  const u = entries.filter(isPlainUser).at(-1);
  return u && rowId(u.key) !== null ? u : null;
}

/**
 * `before` of an action (see the server's rewrite): `key` = the user message to edit, or the first entry of the agent
 * turn to branch from. Undefined = not possible here.
 */
export function cutFor(entries: Entry[], action: HistoryAction, key?: string): number | null | undefined {
  if (action === 'clear') return 0;
  if (action === 'edit') {
    const e = entries.find((x) => x.key === key);
    return e && isPlainUser(e) ? rowId(e.key) ?? undefined : undefined;
  }
  if (action === 'retry' || action === 'undo') {
    const u = lastUser(entries);
    return u ? rowId(u.key)! : undefined;
  }
  // branch: up to the end of the turn = before the next user message, or everything after the last turn
  const at = entries.findIndex((x) => x.key === key);
  if (at < 0) return undefined;
  const next = entries.slice(at + 1).find(isPlainUser);
  if (next) return rowId(next.key) ?? undefined;
  return entries.every((e) => e.kind !== 'user' || rowId(e.key) !== null) ? null : undefined;
}
