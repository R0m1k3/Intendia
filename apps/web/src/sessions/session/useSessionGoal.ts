// The session's persistent goal (option 7): read for the bar above the composer, the /goal dialog, and its
// creation, whose first turn is followed like a sent message.
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, type GoalSettings } from '../../api';
import { goalKey, useGoal } from '../../chat/GoalBar';
import { newSendKey } from '../../chat/queue';
import { invalidateSessionLists } from '../UndoBar';
import { codeOf, type ActiveRun } from './useRunControl';

export function useSessionGoal({ inst, sessionId, knownId, setActive }: {
  inst: string | undefined;
  sessionId: string;
  knownId: () => number | null;
  setActive: (run: ActiveRun | null) => void;
}) {
  const qc = useQueryClient();
  // persistent goal (option 7): relaunched by the server; the bar above the composer, the dialog of /goal
  const goalQ = useGoal(inst, sessionId);
  const [goalDialog, setGoalDialog] = useState<{ editing: boolean; initial: Partial<GoalSettings> } | null>(null);
  // key of the goal's creation, kept with its text until the creation succeeded (same rule as a message's key: a
  // resend of the same goal after an error never starts a second first turn, another goal gets a new key)
  const goalClientKey = useRef<{ text: string; key: string } | null>(null);
  const saveGoal = async (g: GoalSettings) => {
    if (!inst) return;
    if (goalDialog?.editing) await api.editGoal(inst, sessionId, g);
    else {
      const afterId = knownId();
      let res: Awaited<ReturnType<typeof api.createGoal>>;
      try {
        if (goalClientKey.current?.text !== g.text) goalClientKey.current = { text: g.text, key: newSendKey() };
        res = await api.createGoal(inst, sessionId, g, goalClientKey.current.key);
      } catch (err) {
        const code = codeOf(err);
        if (code === 'idempotency_conflict' || code === 'already_sent') goalClientKey.current = null;
        throw err;
      }
      goalClientKey.current = null;
      // the first turn leaves with the goal's text: follow it like a sent message
      qc.setQueryData(['session', inst, sessionId], (old: Awaited<ReturnType<typeof api.session>> | undefined) => old && { ...old, session: { ...old.session, lastRunId: res.runId } });
      setActive({ id: res.runId, createdAt: null, afterId, seed: [{ kind: 'user', key: `u-${res.runId}`, text: g.text, ts: Date.now() / 1000 }] });
      void invalidateSessionLists(qc);
    }
    await qc.invalidateQueries({ queryKey: goalKey(inst, sessionId) });
    await qc.invalidateQueries({ queryKey: ['session', inst, sessionId] });
  };
  return { goalQ, goalDialog, setGoalDialog, saveGoal };
}
