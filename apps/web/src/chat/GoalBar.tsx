// The goal of the session (option 7), above the composer: target, state, relaunch counter, cost, and its buttons.
// While the goal is active, it is re-read every 3 s: a relaunch started by Intendia's server changes the session's
// last run, and the page then plugs into it (the session is re-read, see Session.tsx).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Pencil, Target, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type SessionGoal } from '../api';
import { ask } from '../components/Dialog';
import { cx, ErrorText } from '../components/ui';
import { costLine, goalLine } from './goal';

export const goalKey = (inst: string | undefined, id: string) => ['goal', inst, id] as const;

export function useGoal(inst: string | undefined, sessionId: string) {
  return useQuery({
    queryKey: goalKey(inst, sessionId), queryFn: () => api.goal(inst!, sessionId).then((r) => r.goal),
    enabled: Boolean(inst), refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.status === 'active' ? 3_000 : false),
  });
}

function BarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="grid size-7 place-items-center rounded-md text-ink-soft hover:bg-raised hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function GoalBar({ inst, sessionId, sessionLastRunId, goal, onEdit }: {
  inst: string; sessionId: string; sessionLastRunId: string | null; goal: SessionGoal; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // a run started by the server (relaunch): re-read the session so the page follows it
  useEffect(() => {
    if (goal.lastRunId && goal.lastRunId !== sessionLastRunId) void qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
  }, [goal.lastRunId, sessionLastRunId, qc, inst, sessionId]);
  // the state moved (done, paused): the thread re-reads its messages
  const seen = useRef(`${goal.status}/${goal.relaunches}`);
  useEffect(() => {
    const now = `${goal.status}/${goal.relaunches}`;
    if (now !== seen.current) {
      seen.current = now;
      void qc.invalidateQueries({ queryKey: ['messages', inst, sessionId] });
    }
  }, [goal.status, goal.relaunches, qc, inst, sessionId]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) });
      await qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!await ask({ title: 'Retirer l’objectif ?', message: 'Les relances automatiques s’arrêtent. Le run en cours continue.', confirmLabel: 'Retirer', danger: true })) return;
    await act(() => api.clearGoal(inst, sessionId));
  };

  const done = goal.status === 'done';
  const note = goal.spent.priceUnknown ? 'coût inconnu (prix du modèle absent) : seul le plafond de relances limite'
    : goal.spent.pending ? 'coût en cours de comptage' : null;
  return (
    <div className="mb-2" data-goal-bar data-goal-status={goal.status}>
      <div className={cx('flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px]', done ? 'border-line bg-sheet' : 'border-accent/40 bg-accent-soft/40')}>
        <Target className={cx('size-4 shrink-0', done ? 'text-ink-faint' : 'text-accent-ink')} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={goal.text}>{goal.text}</div>
          <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-soft">
            <span data-goal-line>{goalLine(goal)}</span>
            <span aria-label="Relances" data-goal-count>relance {goal.relaunches}/{goal.maxRelaunches}</span>
            <span data-goal-cost title="Contrôlé entre les tours, avec un tour de retard possible">{costLine(goal)}</span>
            {goal.mode === 'click' && <span>après votre clic</span>}
            {note && <span className="text-ink-faint">{note}</span>}
          </div>
        </div>
        {goal.status === 'active' && <BarButton label="Mettre l’objectif en pause" disabled={busy} onClick={() => void act(() => api.pauseGoal(inst, sessionId, 'button'))}><Pause className="size-4" strokeWidth={1.75} /></BarButton>}
        {goal.status === 'paused' && (
          <button
            type="button" disabled={busy} onClick={() => void act(() => api.resumeGoal(inst, sessionId))}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-accent-ink hover:bg-raised disabled:opacity-40"
          >
            <Play className="size-3.5" strokeWidth={1.75} />{goal.reason === 'click' ? 'Continuer' : 'Reprendre'}
          </button>
        )}
        {!done && <BarButton label="Modifier l’objectif" disabled={busy} onClick={onEdit}><Pencil className="size-3.5" strokeWidth={1.75} /></BarButton>}
        <BarButton label="Retirer l’objectif" disabled={busy} onClick={() => void remove()}><X className="size-4" strokeWidth={1.75} /></BarButton>
      </div>
      <div className="mt-1 empty:hidden"><ErrorText error={error} /></div>
    </div>
  );
}
