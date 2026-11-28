// Moving an empty session, as on the home page: to another folder of its instance and agent, or to another
// instance (a new empty session there, the draft carried over, the old one deleted).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useOpenSession } from '../../chat/column-context';
import { loadChat } from '../../chat/columns';
import { clearDraft, flushDrafts, loadDraft, saveDraft, sessionDraftKey } from '../../chat/draft';
import { forgetSideSession } from '../../chat/embed';
import { pickWorkspace } from '../../chat/newSession';
import { t } from '../../i18n';
import { invalidateSessionLists } from '../UndoBar';

export function useSessionMove({ inst, slug, sessionId, sess, instances, setError }: {
  inst: string | undefined;
  slug: string;
  sessionId: string;
  /** the session as read (`sess.data` of the page) */
  sess: Awaited<ReturnType<typeof api.session>> | undefined;
  instances: Awaited<ReturnType<typeof api.instances>> | undefined;
  setError: (err: unknown) => void;
}) {
  const qc = useQueryClient();
  const goTo = useOpenSession();
  const [switching, setSwitching] = useState(false);
  // its workspace can still change (moved: nothing sent, no file written), as on the home page
  const allWorkspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces, enabled: Boolean(inst) });
  // same instance and same agent (the server refuses another one, as the list's « Déplacer vers… »)
  const agentOf = sess?.profile ?? 'default';
  const siblings = (allWorkspaces.data?.workspaces ?? [])
    .filter((w) => w.instanceId === inst && (w.profile ?? 'default') === agentOf);
  const neverSent = Boolean(sess && !sess.session.lastRunId && !sess.session.copiedFrom);
  // « Instance » card: an empty session becomes an empty session of another instance (the server moves a session
  // within its instance only): a new one in a workspace of `to`, the draft carried over, the column replaced, then the
  // old one deleted (restorable on the server for the undo window) unless a run started meanwhile.
  const pickable = (instances?.instances ?? []).map((i) => ({
    id: i.id, label: i.label, workspaces: (allWorkspaces.data?.workspaces ?? []).filter((w) => w.instanceId === i.id).length,
  }));
  const switchInstance = async (to: string) => {
    if (!inst || to === inst || switching) return;
    setError(null);
    const slugTo = pickWorkspace({
      workspaces: allWorkspaces.data?.workspaces ?? [], inst: to, chat: loadChat(), last: localStorage.getItem('intendia-last-workspace'),
    });
    if (!slugTo) {
      setError(new Error(t('Aucun dossier sur {label}', { label: pickable.find((i) => i.id === to)?.label ?? to })));
      return;
    }
    setSwitching(true);
    const oldId = sessionId;
    const oldKey = sessionDraftKey(inst, oldId);
    try {
      flushDrafts();
      const text = loadDraft(oldKey);
      const { session } = await api.createSession(slugTo);
      if (text) {
        saveDraft(sessionDraftKey(to, session.id), text);
        clearDraft(oldKey);
      }
      void invalidateSessionLists(qc);
      goTo.open(slugTo, session.id);
    } catch (err) {
      setError(err);
      setSwitching(false);
      return;
    }
    void (async () => {
      try {
        const fresh = await api.session(inst, oldId);
        if (fresh.session.lastRunId) return;
        await api.deleteSession(inst, oldId);
        forgetSideSession(inst, oldId);
        void invalidateSessionLists(qc);
      } catch (err) {
        console.error('Session vide non supprimée', err);
      }
    })();
  };
  const moveTo = async (to: string | null) => {
    if (!to || to === slug || !inst) return;
    setError(null);
    try {
      const res = await api.bulkSessions(inst, [sessionId], 'move', to);
      const r = res.results[0];
      if (!r?.ok) throw new Error(r?.error ?? t('Déplacement refusé'));
      await invalidateSessionLists(qc);
      goTo.open(to, sessionId);
    } catch (err) {
      setError(err);
    }
  };
  return { switching, siblings, neverSent, pickable, switchInstance, moveTo };
}
