import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, type RestartStatus } from '../api';
import { Button, cx, ErrorText } from '../components/ui';

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60_000;
export const RESTART_CONFIRM = 'Redémarrer la passerelle ? Les runs en cours seront interrompus. Si la passerelle sert plusieurs agents, tous sont concernés.';

export interface RestartState { running: boolean; done: boolean; status: RestartStatus | null; error: unknown; timedOut: boolean; start: () => void; dismiss: () => void }

/** Starts the restart, then polls its action status until it ends (or 5 min). */
export function useRestart(inst: string, profile: string, onDone: () => void): RestartState {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<RestartStatus | null>(null);
  const [done, setDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [pollError, setPollError] = useState<unknown>(null);
  const begin = useMutation({
    mutationFn: () => api.restartGateway(inst, profile),
    onSuccess: () => { setStatus(null); setDone(false); setTimedOut(false); setPollError(null); setStartedAt(Date.now()); },
  });
  useEffect(() => {
    if (startedAt === null) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api.restartStatus(inst, profile).then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (!s.running && s.exitCode !== null) { setStartedAt(null); setDone(true); onDone(); }
      }).catch((e: unknown) => {
        if (cancelled) return;
        // the gateway may answer nothing while it restarts: keep polling
        if (!(e instanceof ApiError) || e.status >= 500) return;
        setPollError(e); setStartedAt(null);
      });
      if (Date.now() - startedAt > POLL_MAX_MS) { setTimedOut(true); setStartedAt(null); }
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [startedAt, inst, profile]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    running: begin.isPending || startedAt !== null, done, status, error: begin.error ?? pollError, timedOut,
    start: () => begin.mutate(), dismiss: () => { setDone(false); setTimedOut(false); setStatus(null); begin.reset(); setPollError(null); },
  };
}

export function RestartStrip({ state }: { state: RestartState }) {
  const { running, done, status, error, timedOut } = state;
  if (!running && !done && !error && !timedOut) return null;
  const failed = done && status?.exitCode !== 0;
  return (
    <div className={cx('space-y-2 rounded-xl border p-4 text-sm', failed || error ? 'border-bad/40' : 'border-line')}>
      <div className="flex items-center justify-between gap-3">
        <span>
          {running ? 'Redémarrage de la passerelle…'
            : timedOut ? 'Le redémarrage ne s’est pas terminé en 5 minutes : voir l’état de l’instance.'
            : error ? 'Le redémarrage n’a pas pu être lancé ou suivi.'
            : failed ? `Le redémarrage a échoué (code ${status?.exitCode}).` : 'Passerelle redémarrée.'}
        </span>
        {!running && <Button variant="ghost" className="h-7" onClick={state.dismiss}>Fermer</Button>}
      </div>
      <ErrorText error={error} />
      {status && status.lines.length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-lg bg-raised p-3 font-mono text-[12px] text-ink-soft">{status.lines.join('\n')}</pre>
      )}
    </div>
  );
}
