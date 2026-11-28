// Rewriting the history: edit, retry, undo, clear (the session replaced by a truncated copy, « Annuler » for 10 s)
// and branch; when they are possible (and why not), the thread's buttons, and the text given back into the composer.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type RefObject } from 'react';
import { api, ApiError } from '../../api';
import type { ComposerHandle } from '../../chat/Composer';
import { useOpenSession } from '../../chat/column-context';
import type { Entry } from '../../chat/events';
import { ACTION_LABEL, cutFor, lastUser, type HistoryAction } from '../../chat/history-actions';
import type { ThreadActions } from '../../chat/Thread';
import { setDraft, setHandoff, takeDraft } from '../../home/handoff';
import { t } from '../../i18n';
import { newKey } from '../copies';
import { SESSION_LIST_KEYS, showUndo } from '../UndoBar';

export function useHistoryActions({ inst, slug, sessionId, entries, running, queued, sentOnce, canCopy, forgetOlder, setError, composer }: {
  inst: string | undefined;
  slug: string;
  sessionId: string;
  entries: Entry[];
  running: boolean;
  /** messages waiting in the queue */
  queued: number;
  /** the session exists at Hermes (sent once, or a copy) */
  sentOnce: boolean;
  canCopy: boolean;
  forgetOlder: () => void;
  setError: (err: unknown) => void;
  composer: RefObject<ComposerHandle | null>;
}) {
  const qc = useQueryClient();
  const goTo = useOpenSession();
  // edit, retry, undo, clear (the session replaced by a truncated copy, « Annuler » for 10 s) and branch
  const rewrite = useMutation({
    mutationFn: async (a: { action: HistoryAction; before: number | null; text?: string }) => ({
      a, res: await api.rewriteSession(inst!, sessionId, { key: newKey(), before: a.before, mode: a.action === 'branch' ? 'branch' : 'replace' }),
    }),
    onSuccess: async ({ a, res }) => {
      const copy = res.session;
      forgetOlder();
      // the banner first: starting the new run may take longer than the undo window
      let undone = false;
      if (a.action !== 'branch' && res.undoUntil) {
        const original = sessionId;
        showUndo({
          inst: inst!, ids: [], undoUntil: res.undoUntil, label: ACTION_LABEL[a.action],
          run: async () => {
            try {
              await api.revertRewrite(inst!, copy.id);
            } catch (err) {
              // a first answer lost: the original may be back already
              const back = err instanceof ApiError && err.status === 409 && await api.session(inst!, original).then(() => true, () => false);
              if (!back) throw err;
            }
            undone = true;
            await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
            goTo.open(slug, original, copy.id);
          },
        });
      }
      if (a.action === 'undo' && a.text) setDraft({ inst: inst!, sessionId: copy.id, text: a.text });
      if ((a.action === 'edit' || a.action === 'retry') && a.text) {
        try {
          const sent = await api.send(inst!, copy.id, a.text);
          setHandoff({ inst: inst!, sessionId: copy.id, runId: sent.runId, text: a.text, ts: Date.now() / 1000 });
        } catch (err) {
          // the copy is made: the text waits in its composer, with the reason
          setDraft({ inst: inst!, sessionId: copy.id, text: a.text, error: (err as Error).message });
        }
      }
      // « Annuler » clicked while the run was starting: the original is open, stay there
      if (undone) return;
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      goTo.open(slug, copy.id);
    },
    onError: setError,
  });
  // text given back by « Annuler le dernier échange », or a send refused after a replacement: once, into the composer
  const draftRead = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `composer` (a ref) and `setError` (a state setter) from the page, stable: same dependencies as when this code was in pages/Session.tsx
  useEffect(() => {
    if (!inst || draftRead.current) return;
    draftRead.current = true;
    const d = takeDraft(inst, sessionId);
    if (!d) return;
    composer.current?.setText(d.text);
    if (d.error) setError(new Error(d.error));
  }, [inst, sessionId]);

  // history actions: not during a run, nor with messages waiting (they would stay on the replaced session)
  const historyFree = !running && queued === 0 && sentOnce && !rewrite.isPending;
  const canRewrite = historyFree && canCopy;
  const last = lastUser(entries);
  const lastTurn = (() => {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.kind === 'user' && !(entries[i] as { steer?: boolean }).steer) return entries[i + 1]?.key ?? null;
    return null;
  })();
  const runRewrite = (action: HistoryAction, key?: string, text?: string) => {
    const before = cutFor(entries, action, key);
    if (before !== undefined) rewrite.mutate({ action, before, text });
  };
  const threadActions: ThreadActions | undefined = canRewrite ? {
    canEdit: (key) => cutFor(entries, 'edit', key) !== undefined,
    edit: (key, text) => runRewrite('edit', key, text),
    retryTurn: last && lastTurn ? lastTurn : null,
    retry: () => runRewrite('retry', undefined, last?.text),
    canBranch: (key) => cutFor(entries, 'branch', key) !== undefined,
    branch: (key) => runRewrite('branch', key),
    busy: rewrite.isPending,
  } : undefined;
  // why the slash commands that rewrite the history cannot run now
  const rewriteWhy = !sentOnce ? t('La conversation est vide') : running ? t('L’agent travaille') : queued > 0 ? t('Des messages attendent dans la file')
    : !canCopy ? t('Indisponible sur cette instance') : rewrite.isPending ? t('Une action est en cours') : undefined;

  return { canRewrite, last, lastTurn, runRewrite, threadActions, rewriteWhy };
}
