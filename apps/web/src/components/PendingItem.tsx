import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, type ApprovalChoice, type PendingApproval } from '../api';
import { ClarifyCard } from '../chat/ClarifyCard';
import { ApprovalCard } from '../chat/Thread';
import { ErrorText } from './ui';
import { t } from '../i18n';

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

/**
 * One question of an agent (approval or clarify), answered in place: the notifications of Intendia and the Centre.
 * Without `onLater` (Centre), no « Plus tard ».
 */
export function PendingItem({ a, onDone, onLater, showInstance = true }: {
  a: PendingApproval; onDone: () => void; onLater?: () => void; showInstance?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [perm, setPerm] = useState(() => (canNotify() ? Notification.permission : 'denied'));
  const send = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await call();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const choose = (choice: ApprovalChoice) => send(() => api.approve(a.instanceId, a.sessionId, a.runId, choice, a.requestId ?? undefined));
  const answer = (text: string) => send(() => api.clarify(a.instanceId, a.sessionId, a.runId, text, a.requestId ?? undefined));
  const link = 'text-[13px] font-medium text-accent-ink hover:underline';
  const footer = (
    <>
      <ErrorText error={error} />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link to="/w/$slug/s/$sessionId" params={{ slug: a.workspace, sessionId: a.sessionId }} className={link}>{t('Ouvrir la session')}</Link>
        {onLater && <button type="button" onClick={onLater} className={link}>{error ? t('Fermer') : t('Plus tard')}</button>}
        {perm === 'default' && (
          <button type="button" className={link} onClick={() => void Notification.requestPermission().then(setPerm)}>
            {t('Prévenir aussi hors de l’onglet')}
          </button>
        )}
      </div>
    </>
  );
  const clarify = a.kind === 'clarify';
  return (
    <section role="alertdialog" aria-label={clarify ? t('Question sur {instance}', { instance: a.instanceLabel }) : t('Approbation demandée sur {instance}', { instance: a.instanceLabel })} data-approval={a.key}
      className="enter overflow-hidden rounded-xl border border-line bg-sheet shadow-[var(--shadow-card)]">
      <p className="truncate px-4 pb-1 pt-3 text-xs text-ink-soft">
        {showInstance && <><span className="font-medium text-ink">{a.instanceLabel}</span> · </>}{a.workspaceName}{a.title ? ` · ${a.title}` : ''}
      </p>
      <div className="px-2 pb-2">
        {clarify ? (
          <ClarifyCard inline busy={busy} onAnswer={(text) => void answer(text)} disabled={!a.canAnswer} footer={footer}
            clarify={{ requestId: a.requestId, question: a.question ?? t('Hermes vous pose une question : ouvrez la session pour la voir'), choices: a.choices, multiSelect: a.multiSelect }} />
        ) : (
          <ApprovalCard
            inline busy={busy} onChoose={(c) => void choose(c)} footer={footer}
            approval={{
              requestId: a.requestId,
              description: a.description ?? (a.command ? null : t('Hermes attend votre accord : ouvrez la session pour voir la demande')),
              command: a.command, choices: a.canAnswer ? a.choices : [],
            }}
          />
        )}
      </div>
    </section>
  );
}
