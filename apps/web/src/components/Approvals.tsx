import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouterState } from '@tanstack/react-router';
import { BellRing } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { toNotify, visibleApprovals } from './approvals';
import { canNotify, PendingItem } from './PendingItem';

const MAX_SHOWN = 3;
export const CENTRE_PATH = '/activite';

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
  // the Centre lists them already, answered in its « Vous attend » group
  const onCentre = useRouterState({ select: (st) => st.location.pathname === CENTRE_PATH });
  const shown = onCentre ? [] : visibleApprovals(all, { openSession: sessionId, hidden });

  useEffect(() => {
    if (!canNotify() || Notification.permission !== 'granted') return;
    const fresh = toNotify(shown, notified.current);
    if (!document.hidden) return;
    for (const a of fresh) {
      const n = new Notification(`${a.instanceLabel} : ${a.kind === 'clarify' ? 'Hermes vous pose une question' : 'Hermes attend votre accord'}`, { body: a.workspaceName, tag: a.key });
      n.onclick = () => { window.focus(); n.close(); };
    }
  }, [shown]);

  if (shown.length === 0) return null;
  const hide = (key: string) => setHidden((h) => new Set(h).add(key));
  return createPortal(
    <div aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:w-[400px]">
      {shown.slice(0, MAX_SHOWN).map((a) => (
        <PendingItem key={a.key} a={a} onLater={() => hide(a.key)} onDone={() => {
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
