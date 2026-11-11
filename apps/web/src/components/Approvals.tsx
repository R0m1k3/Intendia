import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { BellRing } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type ApprovalChoice, type PendingApproval } from '../api';
import { ApprovalCard } from '../chat/Thread';
import { toNotify, visibleApprovals } from './approvals';
import { ErrorText } from './ui';

const MAX_SHOWN = 3;
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;

function Item({ a, onDone, onLater }: { a: PendingApproval; onDone: () => void; onLater: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [perm, setPerm] = useState(() => (canNotify() ? Notification.permission : 'denied'));
  const choose = async (choice: ApprovalChoice) => {
    setBusy(true);
    setError(null);
    try {
      await api.approve(a.instanceId, a.sessionId, a.runId, choice, a.requestId ?? undefined);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const link = 'text-[13px] font-medium text-accent hover:underline';
  return (
    <section role="alertdialog" aria-label={`Approbation demandée sur ${a.instanceLabel}`} data-approval={a.key}
      className="enter overflow-hidden rounded-xl border border-line bg-sheet shadow-[var(--shadow-card)]">
      <p className="truncate px-4 pb-1 pt-3 text-xs text-ink-soft">
        <span className="font-medium text-ink">{a.instanceLabel}</span> · {a.workspaceName}{a.title ? ` · ${a.title}` : ''}
      </p>
      <div className="px-2 pb-2">
        <ApprovalCard
          inline busy={busy} onChoose={(c) => void choose(c)}
          approval={{
            requestId: a.requestId,
            description: a.description ?? (a.command ? null : 'Hermes attend votre accord : ouvrez la session pour voir la demande'),
            command: a.command, choices: a.canAnswer ? a.choices : [],
          }}
          footer={(
            <>
              <ErrorText error={error} />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link to="/w/$slug/s/$sessionId" params={{ slug: a.workspace, sessionId: a.sessionId }} className={link}>Ouvrir la session</Link>
                <button type="button" onClick={onLater} className={link}>{error ? 'Fermer' : 'Plus tard'}</button>
                {perm === 'default' && (
                  <button type="button" className={link} onClick={() => void Notification.requestPermission().then(setPerm)}>
                    Prévenir aussi hors de l’onglet
                  </button>
                )}
              </div>
            </>
          )}
        />
      </div>
    </section>
  );
}

/**
 * Approvals asked on any instance, whatever the current one: a notification with the question, answered in place.
 * The tab hidden (and the browser allowed), a browser notification too, without the command (lock screen).
 */
export function Approvals() {
  const qc = useQueryClient();
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const list = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), refetchInterval: 10_000, refetchOnWindowFocus: true,
    // keeps polling in a hidden tab: that is when the browser notification is useful
    refetchIntervalInBackground: true,
  });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const notified = useRef(new Set<string>());
  const all = list.data?.approvals ?? [];
  const shown = visibleApprovals(all, { openSession: sessionId, hidden });

  useEffect(() => {
    if (!canNotify() || Notification.permission !== 'granted') return;
    const fresh = toNotify(shown, notified.current);
    if (!document.hidden) return;
    for (const a of fresh) {
      const n = new Notification(`${a.instanceLabel} : Hermes attend votre accord`, { body: a.workspaceName, tag: a.key });
      n.onclick = () => { window.focus(); n.close(); };
    }
  }, [shown]);

  if (shown.length === 0) return null;
  const hide = (key: string) => setHidden((h) => new Set(h).add(key));
  return createPortal(
    <div aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:w-[400px]">
      {shown.slice(0, MAX_SHOWN).map((a) => (
        <Item key={a.key} a={a} onLater={() => hide(a.key)} onDone={() => {
          hide(a.key);
          void qc.invalidateQueries({ queryKey: ['approvals'] });
          void qc.invalidateQueries({ queryKey: ['activity'] });
        }} />
      ))}
      {shown.length > MAX_SHOWN && (
        <p className="flex items-center gap-2 self-end rounded-lg bg-sheet px-3 py-1.5 text-xs text-ink-soft shadow-[var(--shadow-card)]">
          <BellRing className="size-3.5" strokeWidth={1.5} />
          {shown.length - MAX_SHOWN} autre{shown.length - MAX_SHOWN > 1 ? 's' : ''} en attente
        </p>
      )}
    </div>,
    document.body,
  );
}
