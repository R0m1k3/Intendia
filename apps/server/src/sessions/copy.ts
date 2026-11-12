import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { CompatService } from '../compat/service.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import type { ExportSchema } from '../connectors/sessions/index.js';
import { readHistory } from '../chat/history.js';

// One way to copy a session: the dashboard's export, ids of messages removed, imported under a new id with
// source "api_server" (the only one, with bot_room, that accepts runs). Used to duplicate, to continue a session
// born elsewhere (CLI, cron, Telegram, kanban: Hermes refuses runs on them) and to import a file.

export type Exported = z.infer<typeof ExportSchema>;
type Row = Record<string, unknown>;

/** Hermes' import limit is 10 000 messages per session. */
export const MAX_MESSAGES = 10_000;

/** Ids tying a message to its original session: Hermes makes new ones. */
const MESSAGE_IDS = ['id', 'session_id', 'message_uid', 'absorbed_message_uids', 'tool_call_uid', 'tool_call_uids', 'platform_message_id'];

export class CopyError extends Error {
  constructor(readonly code: 'empty' | 'too_many' | 'invalid' | 'refused' | 'busy' | 'cut_not_found' | 'reverted' | 'too_late', message: string, readonly status: 400 | 404 | 409 | 413 | 502 | 503) {
    super(message);
    this.name = 'CopyError';
  }
}

/**
 * Id of the copy made by an action of the browser: derived from the key it creates once per action, so a double
 * click (or a retry after a lost answer) lands on the same session instead of a second copy.
 */
export function copyId(instanceId: string, slug: string, key: string): string {
  const hex = createHash('sha256').update(`${instanceId}:${key}`).digest('hex').slice(0, 16);
  return `iw-${slug}-${BigInt(`0x${hex}`).toString(36).padStart(12, '0').slice(-12)}`;
}

const flag = (v: unknown): boolean | null => (v === undefined || v === null ? null : v === true || v === 1 || v === '1');

/** Text of a message content (string, or the text parts of a list). */
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.map((p) => (p && typeof p === 'object' && typeof (p as Row).text === 'string' ? (p as Row).text as string : null)).filter((t) => t !== null);
    return parts.length ? parts.join('') : null;
  }
  return null;
}

/**
 * The export cut strictly before the message of row id `before` (a live `user` message, not a reorientation), or
 * whole with null, or emptied with 0; `cutTs` = that message's time in seconds (null when unknown or not cut).
 */
export function cutBefore(exported: Exported, before: number | null): { exported: Exported; cutTs: number | null } {
  if (before === null) return { exported, cutTs: null };
  if (before === 0) return { exported: { ...exported, messages: [] }, cutTs: null };
  const rows = exported.messages as Row[];
  const at = rows.findIndex((m) => m.id === before);
  const m = at >= 0 ? rows[at]! : null;
  if (!m || m.role !== 'user' || flag(m.active) === false || m.display_kind === 'steer') {
    throw new CopyError('cut_not_found', 'Ce message ne peut plus servir de point de départ (compressé, retiré ou réorientation)', 409);
  }
  return { exported: { ...exported, messages: exported.messages.slice(0, at) }, cutTs: typeof m.timestamp === 'number' ? m.timestamp : null };
}

/**
 * The session to import. Rewound messages (`active` and `compacted` both false) are left out; compacted ones keep
 * their flags (Hermes restores them as archived history). `untrusted` (a file from outside): only the text of
 * `user` and `assistant` messages, no system prompt, so a file cannot slip instructions or fake tool results into
 * a session one continues.
 */
export function copyPayload(exported: Exported, opts: { id: string; title: string; untrusted?: boolean }): Row {
  const rows = (exported.messages as Row[]).filter((m) => !(flag(m.active) === false && flag(m.compacted) === false));
  let messages: Row[];
  if (opts.untrusted) {
    messages = [];
    for (const m of rows) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = textOf(m.content);
      if (text === null || !text.trim()) continue;
      messages.push({ role: m.role, content: text, ...(typeof m.timestamp === 'number' ? { timestamp: m.timestamp } : {}) });
    }
  } else {
    messages = rows.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !MESSAGE_IDS.includes(k))));
  }
  if (messages.length > MAX_MESSAGES) throw new CopyError('too_many', `Trop de messages (${messages.length}, ${MAX_MESSAGES} au plus)`, 413);
  return {
    id: opts.id, source: 'api_server', title: opts.title,
    ...(exported.model ? { model: exported.model } : {}),
    started_at: typeof exported.started_at === 'number' ? exported.started_at : Date.now() / 1000,
    ...(!opts.untrusted && exported.system_prompt ? { system_prompt: exported.system_prompt } : {}),
    messages,
  };
}

/** The dashboard's export of a session (its live part after a compression); `empty` when it has no message yet. */
export async function exportSession(compat: CompatService, instanceId: string, profile: string, sessionId: string): Promise<Exported> {
  const h = await readHistory(compat, instanceId, sessionId, profile, 1);
  if (!h.exists) throw new CopyError('empty', 'Session vide : rien à copier ni à exporter', 404);
  return callOp<Exported>(compat.http(instanceId), compat.get(instanceId), 'sessions', 'export', {
    params: { session_id: h.liveId }, profile,
  });
}

/**
 * Imports the copy into `profile`. Already there (same key: a retry) → fine: Hermes 0.23 answers 409
 * `revision_conflict` for an id it has (the import is anchored on that id), older ones list it in `skipped_ids`. Hermes busy (storage lock held by a
 * run, seen on 0.23 as 503 storage_unavailable) → `busy`, to try again with the same key.
 */
export async function importCopy(compat: CompatService, instanceId: string, profile: string, payload: Row): Promise<void> {
  const id = payload.id as string;
  let res: { imported_ids: string[]; skipped_ids: string[]; errors: unknown[] };
  try {
    res = await callOp(compat.http(instanceId), compat.get(instanceId), 'sessions', 'import', {
      profile,
      body: { sessions: [payload], request_id: randomUUID(), expected_revision: 0, ...(profile !== 'default' ? { profile } : {}) },
    });
  } catch (err) {
    if (err instanceof HermesError && err.detail.status === 503) throw new CopyError('busy', 'Hermes est occupé : réessayez dans un instant', 503);
    if (err instanceof HermesError && err.detail.status === 409 && (await readHistory(compat, instanceId, id, profile, 1)).exists) return;
    throw err;
  }
  if (res.imported_ids.includes(id) || res.skipped_ids.includes(id)) return;
  const first = res.errors[0];
  const why = typeof first === 'string' ? first : first && typeof first === 'object' ? String((first as Row).error ?? (first as Row).detail ?? JSON.stringify(first)) : 'copie refusée';
  throw new CopyError('refused', `Hermes a refusé la copie : ${why}`, 502);
}
