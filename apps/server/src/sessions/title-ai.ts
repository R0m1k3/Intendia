// "Titre par l'IA": the auxiliary model of Hermes for titles (`llm.oneshot` on the dashboard WebSocket, the only way:
// no HTTP route makes a title), from the start of the conversation; saved like a rename.
import type { CompatService } from '../compat/service.js';
import { readHistory } from '../chat/history.js';
import { GatewaySocketError, oneshot } from '../hermes/gateway-ws.js';
import type { WsFactory } from '../hermes/events.js';
import { pushTitle } from '../workspaces/title.js';
import { TITLE_MAX, type PublicSession, type SessionContext, type WorkspaceService } from '../workspaces/service.js';
import { CopyError } from './copy.js';

const INSTRUCTIONS = 'Donne un titre court (6 mots au plus) à cette conversation, dans sa langue. Réponds par le titre seul, sans guillemets ni ponctuation finale.';
/** The start of the conversation is enough for a title. */
const MESSAGES = 6;
const MESSAGE_CHARS = 600;
const TIMEOUT_MS = 30_000;

/** One generation at a time per session (a double click). */
const pending = new Set<string>();

export class TitleError extends Error {
  constructor(readonly code: 'unsupported' | 'busy' | 'no_model' | 'empty', message: string, readonly status: 409 | 502 | 503) {
    super(message);
  }
}

/** The model's answer as a title: first line, quotes and final dot removed, at most TITLE_MAX characters. */
export function cleanTitle(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const bare = line.replace(/^(titre\s*:\s*)/i, '').replace(/^["'«“\s]+|["'»”\s]+$/g, '').replace(/[.。!]+$/, '').trim();
  return bare.length <= TITLE_MAX ? bare : `${bare.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export async function generateTitle(
  deps: { workspaces: WorkspaceService; compat: CompatService; wsFactory?: WsFactory },
  ctx: SessionContext,
): Promise<PublicSession> {
  const { workspaces, compat } = deps;
  if (!compat.get(ctx.instance.id)?.socket?.oneshot) throw new TitleError('unsupported', 'Titre par l’IA indisponible sur cette instance', 409);
  const key = `${ctx.instance.id}:${ctx.session.id}`;
  if (pending.has(key)) throw new TitleError('busy', 'Un titre est déjà en préparation', 409);
  pending.add(key);
  try {
    const h = await readHistory(compat, ctx.instance.id, ctx.session.id, ctx.profile);
    const lines = h.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
      .slice(0, MESSAGES)
      .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Agent'} : ${m.content.trim().slice(0, MESSAGE_CHARS)}`);
    if (!lines.length) throw new CopyError('empty', 'Session vide : rien pour faire un titre', 404);
    let text: string;
    try {
      text = await oneshot(ctx.instance, {
        instructions: INSTRUCTIONS, input: lines.join('\n\n'), task: 'title_generation', max_tokens: 40,
        ...(ctx.profile !== 'default' ? { profile: ctx.profile } : {}),
      }, { factory: deps.wsFactory ?? compat.wsFactory, timeoutMs: TIMEOUT_MS });
    } catch (err) {
      if (err instanceof GatewaySocketError && err.code === 5030) throw new TitleError('no_model', 'Aucun modèle n’est configuré pour les titres sur cette instance', 503);
      if (err instanceof GatewaySocketError) throw new TitleError('empty', `Titre non obtenu : ${err.message}`, 502);
      throw err;
    }
    const title = cleanTitle(text);
    if (!title) throw new TitleError('empty', 'Le modèle n’a pas proposé de titre', 502);
    const session = workspaces.updateSession(ctx.instance.id, ctx.session.id, { title });
    await pushTitle(deps, workspaces.getSession(ctx.instance.id, ctx.session.id), session.title);
    return session;
  } finally {
    pending.delete(key);
  }
}
