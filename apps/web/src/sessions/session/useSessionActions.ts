// Actions on the session itself (header menu, palette, run options): rename, pin, archive, duplicate, delete,
// title by the AI, model / effort / agent of the next messages, « Sans confirmation », and the link to copy.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Effort } from '../../api';
import { useOpenSession } from '../../chat/column-context';
import { ask, askText } from '../../components/Dialog';
import { copyText } from '../../components/ui';
import { t } from '../../i18n';
import { newKey, useCopyOps } from '../copies';
import { useRemoveSession } from '../remove';
import { SESSION_LIST_KEYS, invalidateSessionLists } from '../UndoBar';

export type SessionActions = ReturnType<typeof useSessionActions>;

export function useSessionActions({ inst, slug, sessionId, sess, agentProfile, setError }: {
  inst: string | undefined;
  slug: string;
  sessionId: string;
  /** the session as read (`sess.data` of the page) */
  sess: Awaited<ReturnType<typeof api.session>> | undefined;
  agentProfile: string;
  setError: (err: unknown) => void;
}) {
  const qc = useQueryClient();
  const goTo = useOpenSession();
  const rename = useMutation({
    meta: { fail: true },
    mutationFn: (title: string) => api.updateSession(inst!, sessionId, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', inst, sessionId] }).then(() => invalidateSessionLists(qc)),
  });
  const archive = useMutation({
    meta: { fail: true },
    mutationFn: (archived: boolean) => api.updateSession(inst!, sessionId, { archived }),
    onSuccess: async (_res, archived) => {
      await invalidateSessionLists(qc);
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
      if (archived) goTo.leave(slug);
    },
  });
  const pin = useMutation({
    meta: { fail: true },
    mutationFn: (pinned: boolean) => api.updateSession(inst!, sessionId, { pinned }),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void invalidateSessionLists(qc);
    },
  });
  /** Model / effort of the next messages (also remembered as the workspace's last choice). */
  const setOptions = useMutation({
    mutationFn: (patch: { model?: string | null; provider?: string | null; effort?: Effort | null; autoApprove?: boolean; profile?: string | null }) =>
      api.updateSession(inst!, sessionId, patch),
    onSuccess: (res, patch) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      // another agent: the effective profile (models, modes, skills) is read again
      if (patch.profile !== undefined) void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
      void qc.invalidateQueries({ queryKey: ['workspace', slug] });
    },
    onError: setError,
  });
  const { canCopy, canExportJson, canTitleAi } = useCopyOps(inst);
  const titleAi = useMutation({
    mutationFn: () => api.generateTitle(inst!, sessionId),
    onSuccess: (res) => {
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: res.session });
      void invalidateSessionLists(qc);
    },
    onError: setError,
  });
  // « Sans confirmation »: Intendia approves every action of the agent in this session
  const setAutoApprove = async (on: boolean) => {
    if (on && !(await ask({
      title: t('Travailler sans confirmation ?'), danger: true, confirmLabel: t('Activer'),
      message: t('L’agent exécutera ses commandes et ses écritures sans vous demander votre accord, dans cette session seulement, tant que ce réglage reste actif. Les questions qu’il vous pose attendent toujours votre réponse.'),
    }))) return;
    setOptions.mutate({ autoApprove: on });
  };
  // another agent: a session never sent changes agent; one with messages is copied there (the original stays)
  const changeProfile = async (profile: string) => {
    const s = sess?.session;
    if (!s || !inst) return;
    if (!s.lastRunId && !s.copiedFrom) { setOptions.mutate({ profile }); return; }
    if (!(await ask({
      title: t('Continuer avec l’agent {profile} ?', { profile }), confirmLabel: t('Copier la conversation'),
      message: s.autoApprove
        ? t('La conversation est copiée chez l’agent {profile}, dans ce dossier ; cette session reste telle quelle. « Sans confirmation » repart désactivé.', { profile })
        : t('La conversation est copiée chez l’agent {profile}, dans ce dossier ; cette session reste telle quelle.', { profile }),
    }))) return;
    try {
      const { session } = await api.toProfile(inst, sessionId, profile, newKey());
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.open(slug, session.id);
    } catch (err) {
      setError(err);
    }
  };
  const duplicate = useMutation({
    mutationFn: (key: string) => api.duplicateSession(inst!, sessionId, key),
    onSuccess: async ({ session }) => {
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.open(slug, session.id);
    },
    onError: setError,
  });
  // deleted at Hermes only once the undo window is over (banner « Annuler »)
  // (the hook closes its Chat column; `leave` closing it again changes nothing)
  const rm = useRemoveSession();
  const remove = useMutation({
    mutationFn: () => rm.remove({ kind: 'intendia', inst: inst!, profile: agentProfile, id: sessionId, slug }),
    onSuccess: () => goTo.leave(slug),
    onError: setError,
  });

  const [linkCopied, setLinkCopied] = useState(false);
  // the same handlers as the header's menu and link button, for the palette too
  const renameSession = async () => {
    const next = await askText({ title: t('Renommer la session'), label: t('Nouveau titre'), value: sess?.session.title ?? '', confirmLabel: t('Renommer') });
    if (next) rename.mutate(next);
  };
  const copyLink = () => void copyText(window.location.origin + window.location.pathname, t('Lien de la session')).then(() => {
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  });

  return {
    rename, archive, pin, setOptions, titleAi, duplicate, remove, canCopy, canExportJson, canTitleAi,
    setAutoApprove, changeProfile, renameSession, copyLink, linkCopied,
  };
}
