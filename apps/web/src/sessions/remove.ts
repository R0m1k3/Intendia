import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from '../api';
import { forgetSideSession } from '../chat/embed';
import { close, updateChat, type Chat } from '../chat/columns';
import { ask } from '../components/Dialog';
import { invalidateSessionLists, showUndo } from './UndoBar';
import { t } from '../i18n';

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
export function useRemoveSession(): { remove: (target: RemoveTarget) => Promise<{ chat: Chat | null } | null>; pending: ReadonlySet<string> } {
  const qc = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback((id: string, on: boolean) => setPending((p) => {
    const next = new Set(p);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const remove = useCallback(async (target: RemoveTarget): Promise<{ chat: Chat | null } | null> => {
    if (target.kind === 'hermes') {
      const ok = await ask({
        title: t('Supprimer cette session ?'), danger: true, confirmLabel: t('Supprimer'),
        message: t('Hermes la supprime définitivement, messages compris. Pas d’annulation possible.'),
      });
      if (!ok) return null;
    }
    mark(target.id, true);
    try {
      if (target.kind === 'hermes') {
        await api.deleteExternal(target.inst, target.id, target.profile);
        qc.removeQueries({ queryKey: ['external', target.inst, target.profile, target.id] });
        await invalidateSessionLists(qc);
        return { chat: null };
      }
      const { undoUntil } = await api.deleteSession(target.inst, target.id);
      showUndo({ inst: target.inst, ids: [target.id], undoUntil, label: t('Session supprimée') });
      forgetSideSession(target.inst, target.id);
      await invalidateSessionLists(qc);
      return { chat: updateChat((c) => close(c, target.id)) };
    } finally {
      mark(target.id, false);
    }
  }, [qc, mark]);
  return { remove, pending };
}

/**
 * Where to go once the session shown is deleted from the list or its page: the active Chat column left (the rule of
 * the Chat page's `closeCol`), else the workspace of an Intendia session, else the home page.
 */
export function afterRemoveRoute(chat: Chat | null, target: RemoveTarget): { to: string; params?: Record<string, string> } {
  if (target.kind === 'hermes') return { to: '/' };
  const active = chat?.open.find((c) => c.id === chat.active && c.id !== target.id);
  if (active) return { to: '/w/$slug/s/$sessionId', params: { slug: active.slug, sessionId: active.id } };
  return target.slug ? { to: '/w/$slug', params: { slug: target.slug } } : { to: '/' };
}
