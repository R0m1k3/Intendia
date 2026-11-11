import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Cron, type CronRun } from '../api';
import { FOLLOW_INTERVAL_MS, followState, statusLabel, type FollowSnapshot } from '../crons/follow';
import { whenFr } from '../crons/schedule';
import { Button, cx, ErrorText, Mark } from './ui';

const fmt = (s: number) => new Date(s * 1000).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

function duration(r: CronRun): string | null {
  if (r.startedAt === null || r.endedAt === null) return null;
  const s = Math.max(0, Math.round(r.endedAt - r.startedAt));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
}

function RunLine({ cron, run, live }: { cron: Cron; run: CronRun; live?: boolean }) {
  const d = duration(run);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px]">
      <span className="w-40 shrink-0 text-ink-soft">{run.startedAt ? fmt(run.startedAt) : '-'}</span>
      <span className="flex-1 font-mono text-[11px] text-ink-faint">
        {live ? 'en cours' : d ?? 'fin non enregistrée'} · {run.messageCount} message{run.messageCount > 1 ? 's' : ''} · {run.toolCallCount} outil{run.toolCallCount > 1 ? 's' : ''}
        {run.costUsd !== null ? ` · ${run.costUsd.toFixed(3)} $` : ''}{run.endReason ? ` · ${run.endReason}` : ''}
      </span>
      <Link to="/i/$inst/p/$profile/s/$sessionId" params={{ inst: cron.instanceId, profile: cron.profile, sessionId: run.id }}
        className="inline-flex items-center gap-1 text-[13px] text-accent hover:text-accent-strong">
        Ouvrir
        <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
      </Link>
    </li>
  );
}

/** History of a cron and, after "Lancer", the live follow-up of the triggered run. */
export function CronRuns({ cron, follow, canRuns, canCancel, onFollowEnd }: {
  cron: Cron; follow: FollowSnapshot | null; canRuns: boolean; canCancel: boolean; onFollowEnd: () => void;
}) {
  const qc = useQueryClient();
  const following = follow !== null;
  const live = useQuery({
    queryKey: ['cron', cron.instanceId, cron.id],
    queryFn: () => api.cron(cron.instanceId, cron.id, cron.profile).then((r) => r.cron),
    enabled: following,
    refetchInterval: following ? FOLLOW_INTERVAL_MS : false,
  });
  const runs = useQuery({
    queryKey: ['cron-runs', cron.instanceId, cron.id],
    queryFn: () => api.cronRuns(cron.instanceId, cron.id, cron.profile).then((r) => r.runs),
    enabled: canRuns,
    refetchInterval: following ? FOLLOW_INTERVAL_MS : false,
  });
  const [, tick] = useState(0);
  const state = follow ? followState(follow, live.data, runs.data) : null;
  const [result, setResult] = useState<{ cron: Cron; timeout: boolean } | null>(null);

  useEffect(() => {
    if (!follow) return;
    const t = setInterval(() => tick((n) => n + 1), FOLLOW_INTERVAL_MS);
    return () => clearInterval(t);
  }, [follow]);

  useEffect(() => {
    if (!state || state.state === 'running') return;
    setResult({ cron: live.data ?? cron, timeout: state.state === 'timeout' });
    void qc.invalidateQueries({ queryKey: ['crons', cron.instanceId] });
    void qc.invalidateQueries({ queryKey: ['crons-overview'] });
    onFollowEnd();
  }, [state?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = useMutation({ mutationFn: () => api.cancelCron(cron.instanceId, cron.id, cron.profile) });
  const history = (runs.data ?? []).filter((r) => !(following && state?.run && r.id === state.run.id));
  const res = result && statusLabel(result.cron.lastStatus);

  return (
    <div className="mt-3 rounded-lg border border-line bg-paper px-4 py-3">
      {following && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3 text-[13px]" aria-live="polite">
          <span className="relative inline-flex size-2.5"><Mark state="readonly" /></span>
          <span className="font-medium">Exécution en cours</span>
          <span className="text-ink-faint">
            {state?.run ? `${state.run.messageCount} message${state.run.messageCount > 1 ? 's' : ''} · ${state.run.toolCallCount} outil${state.run.toolCallCount > 1 ? 's' : ''}` : 'en attente du démarrage'}
          </span>
          {canCancel && (
            <Button type="button" variant="danger" className="ml-auto h-8 px-2.5 text-[13px]" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <Square className="size-3.5" strokeWidth={1.5} />
              {cancel.isPending ? 'Annulation…' : 'Annuler'}
            </Button>
          )}
          {cancel.data && !cancel.data.cancelled && <span className="w-full text-xs text-ink-faint">{cancel.data.detail}</span>}
          <div className="w-full empty:hidden"><ErrorText error={cancel.error ?? live.error} /></div>
        </div>
      )}
      {result && res && (
        <div className={cx('border-b border-line pb-3 text-[13px]', res.ok === false && 'text-bad')} aria-live="polite">
          {result.timeout
            ? 'Suivi arrêté après 10 minutes : le run continue peut-être côté Hermes.'
            : <>Exécution terminée {whenFr(result.cron.lastRunAt)} : <span className="font-medium">{res.label}</span></>}
          {!result.timeout && result.cron.lastError && <p className="mt-1 break-words font-mono text-[11px]">{result.cron.lastError}</p>}
          {!result.timeout && result.cron.lastDeliveryError && <p className="mt-1 break-words font-mono text-[11px]">Envoi : {result.cron.lastDeliveryError}</p>}
        </div>
      )}
      {following && state?.run && <ul><RunLine cron={cron} run={state.run} live /></ul>}
      {!canRuns ? (
        <p className="py-2 text-[13px] text-ink-soft">Historique indisponible sur cette instance (dashboard requis)</p>
      ) : runs.isLoading ? (
        <p className="py-2 text-[13px] text-ink-faint">Chargement…</p>
      ) : history.length === 0 && !following ? (
        <p className="py-2 text-[13px] text-ink-soft">Aucune exécution pour l’instant : « Lancer » en déclenche une tout de suite.</p>
      ) : (
        <ul className="divide-y divide-line">{history.map((r) => <RunLine key={r.id} cron={cron} run={r} />)}</ul>
      )}
      <ErrorText error={runs.error} />
    </div>
  );
}
