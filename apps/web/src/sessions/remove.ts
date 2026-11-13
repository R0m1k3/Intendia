import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '../api';
import { forgetSideSession } from '../chat/embed';
import { close, updateChat, type Chat } from '../chat/columns';
import { ask } from '../components/Dialog';
import { invalidateSessionLists, showUndo } from './UndoBar';

export interface RemoveTarget {
  /** `intendia`: hidden now, « Annuler » for a few seconds, deleted at Hermes later; `hermes`: deleted now, after a confirmation */
  kind: 'intendia' | 'hermes';
  inst: string;
  profile: string;
  id: string;
  /** workspace of an Intendia session */
  slug?: string;
}

/**
 * The one deletion of the web (session menu, inbox rows, page of a session born elsewhere). Resolves to null when the
 * confirmation is refused, else to the Chat columns once the session's one is closed (null for a session born
 * elsewhere: it never has a column). Where to go next stays with the caller.
 */
export function useRemoveSession(): { remove: (t: RemoveTarget) => Promise<{ chat: Chat | null } | null>; pending: ReadonlySet<string> } {
  const qc = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback((id: string, on: boolean) => setPending((p) => {
    const next = new Set(p);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const remove = useCallback(async (t: RemoveTarget): Promise<{ chat: Chat | null } | null> => {
    if (t.kind === 'hermes') {
      const ok = await ask({
        title: 'Supprimer cette session ?', danger: true, confirmLabel: 'Supprimer',
        message: 'Hermes la supprime définitivement, messages compris. Pas d’annulation possible.',
      });
      if (!ok) return null;
    }
    mark(t.id, true);
    try {
      if (t.kind === 'hermes') {
        await api.deleteExternal(t.inst, t.id, t.profile);
        qc.removeQueries({ queryKey: ['external', t.inst, t.profile, t.id] });
        await invalidateSessionLists(qc);
        return { chat: null };
      }
      const { undoUntil } = await api.deleteSession(t.inst, t.id);
      showUndo({ inst: t.inst, ids: [t.id], undoUntil, label: 'Session supprimée' });
      forgetSideSession(t.inst, t.id);
      await invalidateSessionLists(qc);
      return { chat: updateChat((c) => close(c, t.id)) };
    } finally {
      mark(t.id, false);
    }
  }, [qc, mark]);
  return { remove, pending };
}

/**
 * Where to go once the session shown is deleted from the list or its page: the active Chat column left (the rule of
 * the Chat page's `closeCol`), else the workspace of an Intendia session, else the home page.
 */
export function afterRemoveRoute(chat: Chat | null, t: RemoveTarget): { to: string; params?: Record<string, string> } {
  if (t.kind === 'hermes') return { to: '/' };
  const active = chat?.open.find((c) => c.id === chat.active && c.id !== t.id);
  if (active) return { to: '/w/$slug/s/$sessionId', params: { slug: active.slug, sessionId: active.id } };
  return t.slug ? { to: '/w/$slug', params: { slug: t.slug } } : { to: '/' };
}
