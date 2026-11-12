import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCw, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type GatewayAction, type RestartStatus } from '../api';
import { ask } from '../components/Dialog';
import { Button, cx, ErrorText } from '../components/ui';
import { RESTART_CONFIRM } from '../config/restart';

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60_000;
const ICON = 'size-4';

const LABEL: Record<GatewayAction, { running: string; done: string; failed: string }> = {
  start: { running: 'Démarrage de la passerelle…', done: 'Passerelle démarrée.', failed: 'Le démarrage a échoué' },
  stop: { running: 'Arrêt de la passerelle…', done: 'Passerelle arrêtée.', failed: 'L’arrêt a échoué' },
  restart: { running: 'Redémarrage de la passerelle…', done: 'Passerelle redémarrée.', failed: 'Le redémarrage a échoué' },
};

const codeOf = (e: unknown) => (e instanceof ApiError ? (e.data as { code?: string } | undefined)?.code : undefined);
const MULTIPLEXED = 'Cet agent est servi par la passerelle commune : arrêtez-la ou démarrez-la depuis le profil principal.';

/**
 * Start, stop and restart of an agent's gateway, then the action's log until it ends. Start stays reachable when the
 * API server is down (the dashboard runs it). After an action the instance is checked again: the modules that need
 * the API server come back (or go) with it.
 */
export function Gateway({ inst, profile, running, can, compact = false }: {
  inst: string; profile: string; running: boolean | null; can: Record<GatewayAction, boolean>; compact?: boolean;
}) {
  const qc = useQueryClient();
  const [action, setAction] = useState<GatewayAction | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<RestartStatus | null>(null);
  const [done, setDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: ({ a, interrupt }: { a: GatewayAction; interrupt: boolean }) => api.gatewayAction(inst, profile, a, interrupt),
    onSuccess: (_r, { a }) => { setAction(a); setStatus(null); setDone(false); setTimedOut(false); setStartedAt(Date.now()); },
  });

  const finished = async () => {
    await qc.invalidateQueries({ queryKey: ['agents', inst] });
    await qc.invalidateQueries({ queryKey: ['agent', inst, profile] });
    try {
      await api.recheck(inst);
    } finally {
      await qc.invalidateQueries({ queryKey: ['compat'] });
    }
  };

  useEffect(() => {
    if (startedAt === null || action === null) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api.gatewayActionStatus(inst, profile, action).then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (!s.running && s.exitCode !== null) { setStartedAt(null); setDone(true); void finished(); }
      }).catch(() => { /* the gateway may answer nothing while it changes state: keep polling */ });
      if (Date.now() - startedAt > POLL_MAX_MS) { setTimedOut(true); setStartedAt(null); }
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [startedAt, action, inst, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (a: GatewayAction) => {
    setNotice(null);
    if (a === 'restart' && !(await ask(RESTART_CONFIRM))) return;
    if (a === 'stop') {
      const ok = await ask({
        title: `Arrêter la passerelle de ${profile} ?`, danger: true, confirmLabel: 'Arrêter',
        message: `Le chat, les runs et les crons de cet agent s’arrêtent jusqu’au redémarrage. En conteneur, elle reste arrêtée même après un redémarrage du conteneur.${profile === 'default' ? ' Si elle sert aussi d’autres agents (multiplexeur), ils s’arrêtent tous.' : ''}`,
      });
      if (!ok) return;
    }
    try {
      await run.mutateAsync({ a, interrupt: false });
    } catch (e) {
      const code = codeOf(e);
      const detail = e instanceof Error ? e.message : '';
      if (code === 'multiplexed') { run.reset(); setNotice(`${MULTIPLEXED} ${detail}`); return; }
      if (code !== 'refused') return;
      run.reset();
      const force = await ask({
        title: 'Hermes refuse l’arrêt', danger: true, confirmLabel: 'Interrompre et arrêter',
        message: `Hermes refuse : ${detail}. Interrompre les sessions en cours et arrêter quand même ?`,
      });
      if (!force) return;
      try {
        await run.mutateAsync({ a, interrupt: true });
      } catch (e2) {
        // the live sessions were not the reason: the multiplexer serves this profile
        if (codeOf(e2) === 'multiplexed') { run.reset(); setNotice(`${MULTIPLEXED} ${e2 instanceof Error ? e2.message : ''}`); }
      }
    }
  };

  const busy = run.isPending || startedAt !== null;
  const failed = done && status?.exitCode !== 0;
  const l = action ? LABEL[action] : null;
  return (
    <div className="space-y-2" data-gateway={profile}>
      <div className={cx('flex flex-wrap items-center gap-2', compact && 'justify-end')}>
        {!compact && (
          <span className="mr-auto inline-flex items-center gap-2 text-sm">
            <span className={cx('size-2 rounded-full', running === null ? 'bg-ink-faint' : running ? 'bg-ok' : 'bg-bad')} />
            {running === null ? 'État inconnu' : running ? 'En marche' : 'Arrêtée'}
          </span>
        )}
        {running !== true && can.start && (
          <Button onClick={() => void go('start')} disabled={busy}><Play className={ICON} strokeWidth={1.5} />Démarrer</Button>
        )}
        {running !== false && !compact && (
          <>
            {can.restart && <Button onClick={() => void go('restart')} disabled={busy}><RotateCw className={ICON} strokeWidth={1.5} />Redémarrer</Button>}
            {can.stop && <Button onClick={() => void go('stop')} disabled={busy}><Square className={ICON} strokeWidth={1.5} />Arrêter</Button>}
          </>
        )}
      </div>
      {notice && <p role="alert" className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{notice}</p>}
      <ErrorText error={run.error} />
      {l && (busy || done || timedOut) && (
        <div className={cx('space-y-2 rounded-xl border p-3 text-sm', failed ? 'border-bad/40' : 'border-line')} role="status">
          <div className="flex items-center justify-between gap-3">
            <span>
              {busy ? l.running
                : timedOut ? 'L’action ne s’est pas terminée en 5 minutes : voir l’état de l’instance.'
                : failed ? `${l.failed} (code ${status?.exitCode}).` : l.done}
            </span>
            {!busy && <Button variant="ghost" className="h-7" onClick={() => { setDone(false); setTimedOut(false); setStatus(null); setAction(null); }}>Fermer</Button>}
          </div>
          {status && status.lines.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-raised p-3 font-mono text-[12px] text-ink-soft">{status.lines.join('\n')}</pre>
          )}
        </div>
      )}
    </div>
  );
}
