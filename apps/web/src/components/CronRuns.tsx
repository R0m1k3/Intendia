import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Cron, type CronRun } from '../api';
import { FOLLOW_INTERVAL_MS, followState, statusLabel, type FollowSnapshot } from '../crons/follow';
import { whenFr } from '../crons/schedule';
import { Button, cx, ErrorText } from './ui';
import { locale, plural, t } from '../i18n';
import { T } from '../i18n/T';

const fmt = (s: number) => new Date(s * 1000).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function duration(r: CronRun): string | null {
  if (r.startedAt === null || r.endedAt === null) return null;
  const s = Math.max(0, Math.round(r.endedAt - r.startedAt));
  return s < 60 ? t('{s} s', { s }) : t('{min} min {s}', { min: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') });
}

/** How a follow-up ended: shown above the history of that cron. */
export interface FollowResult { cron: Cron; timeout: boolean }

/** Run dot: orange while running, red when the run ended on an error, grey without an end, green otherwise. */
function dotClass(run: CronRun, live: boolean): string {
  if (live) return 'bg-accent animate-pulse';
  if (run.endedAt === null) return 'bg-ink-faint/50';
  if (run.endReason && /error|fail|exception|crash/i.test(run.endReason)) return 'bg-bad';
  return 'bg-dot-ok';
}

/** « 3 messages · 2 outils » of a run. */
const counts = (r: CronRun) => `${plural(r.messageCount, '{n} message', '{n} messages')} · ${plural(r.toolCallCount, '{n} outil', '{n} outils')}`;

function RunLine({ cron, run, live = false }: { cron: Cron; run: CronRun; live?: boolean }) {
  const d = duration(run);
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line/70 px-4 py-2.5 text-[13.5px]">
      <span aria-hidden className={cx('size-2 shrink-0 rounded-full', dotClass(run, live))} />
      <span className="w-[7.5rem] shrink-0 font-mono text-[12.5px]">{run.startedAt ? fmt(run.startedAt) : '-'}</span>
      <span className="min-w-0 flex-1 text-ink-soft">
        {live ? `${t('En cours')} · ` : ''}{counts(run)}
        {run.costUsd !== null ? ` · ${run.costUsd.toFixed(3)} $` : ''}{run.endReason ? ` · ${run.endReason}` : ''}
      </span>
      <span className="font-mono text-xs text-ink-faint">{live ? t('en cours') : d ?? t('fin non enregistrée')}</span>
      <Link to="/i/$inst/p/$profile/s/$sessionId" params={{ inst: cron.instanceId, profile: cron.profile, sessionId: run.id }}
        className="inline-flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink">
        {t('Ouvrir')}
        <ArrowUpRight className="size-3.5" strokeWidth={1.5} />
      </Link>
    </li>
  );
}

/**
 * Watches a triggered run until Hermes writes a new last_run_at (or 10 minutes): rendered by the page for every
 * followed cron, selected or not, so changing the selection does not stop a follow-up. Renders nothing.
 */
export function CronFollower({ cron, follow, canRuns, onEnd }: {
  cron: Cron; follow: FollowSnapshot; canRuns: boolean; onEnd: (r: FollowResult) => void;
}) {
  const qc = useQueryClient();
  const live = useQuery({
    queryKey: ['cron', cron.instanceId, cron.id],
    queryFn: () => api.cron(cron.instanceId, cron.id, cron.profile).then((r) => r.cron),
    refetchInterval: FOLLOW_INTERVAL_MS,
  });
  const runs = useQuery({
    queryKey: ['cron-runs', cron.instanceId, cron.id],
    queryFn: () => api.cronRuns(cron.instanceId, cron.id, cron.profile).then((r) => r.runs),
    enabled: canRuns,
    refetchInterval: FOLLOW_INTERVAL_MS,
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  const state = followState(follow, live.data, runs.data);
  useEffect(() => {
    if (state.state === 'running') return;
    void qc.invalidateQueries({ queryKey: ['crons', cron.instanceId] });
    void qc.invalidateQueries({ queryKey: ['crons-overview'] });
    onEnd({ cron: live.data ?? cron, timeout: state.state === 'timeout' });
  }, [state.state]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** "Dernières exécutions" of a cron: the live run while followed, how the last follow-up ended, then the history. */
export function CronRuns({ cron, follow, result, canRuns, canCancel }: {
  cron: Cron; follow: FollowSnapshot | null; result: FollowResult | null; canRuns: boolean; canCancel: boolean;
}) {
  const following = follow !== null;
  // same keys as CronFollower: the data it polls is shared
  const live = useQuery({
    queryKey: ['cron', cron.instanceId, cron.id],
    queryFn: () => api.cron(cron.instanceId, cron.id, cron.profile).then((r) => r.cron),
    enabled: following,
  });
  const runs = useQuery({
    queryKey: ['cron-runs', cron.instanceId, cron.id],
    queryFn: () => api.cronRuns(cron.instanceId, cron.id, cron.profile).then((r) => r.runs),
    enabled: canRuns,
  });
  const state = follow ? followState(follow, live.data, runs.data) : null;
  const cancel = useMutation({ mutationFn: () => api.cancelCron(cron.instanceId, cron.id, cron.profile) });
  const history = (runs.data ?? []).filter((r) => !(following && state?.run && r.id === state.run.id));
  const res = result && statusLabel(result.cron.lastStatus);
  const note = 'border-t border-line/70 px-4 py-3 text-[13px]';

  return (
    <section className="card overflow-hidden" aria-labelledby={`runs-${cron.id}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <h3 id={`runs-${cron.id}`} className="text-[15px] font-semibold">{t('Dernières exécutions')}</h3>
        {runs.data && <span className="font-mono text-[11px] text-ink-faint">{runs.data.length}</span>}
      </div>
      {following && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line/70 bg-accent-soft/60 px-4 py-3 text-[13px]" aria-live="polite">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
          <span className="font-medium">{t('Exécution en cours')}</span>
          <span className="text-ink-soft">
            {state?.run ? counts(state.run) : t('en attente du démarrage')}
          </span>
          {canCancel && (
            <Button type="button" variant="danger" className="ml-auto h-8 px-2.5 text-[13px]" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <Square className="size-3.5" strokeWidth={1.5} />
              {cancel.isPending ? t('Annulation…') : t('Annuler')}
            </Button>
          )}
          {cancel.data && !cancel.data.cancelled && <span className="w-full text-xs text-ink-faint">{cancel.data.detail}</span>}
          <div className="w-full empty:hidden"><ErrorText error={cancel.error ?? live.error} /></div>
        </div>
      )}
      {!following && result && res && (
        <div className={cx(note, res.ok === false && 'bg-bad-soft/60 text-bad')} aria-live="polite">
          {result.timeout
            ? t('Suivi arrêté après 10 minutes : le run continue peut-être côté Hermes.')
            : <T k="Exécution terminée {when} : {status}" vars={{ when: whenFr(result.cron.lastRunAt), status: <span className="font-medium">{res.label}</span> }} />}
          {!result.timeout && result.cron.lastError && <p className="mt-1 break-words font-mono text-[11px]">{result.cron.lastError}</p>}
          {!result.timeout && result.cron.lastDeliveryError && <p className="mt-1 break-words font-mono text-[11px]">{t('Envoi : {error}', { error: result.cron.lastDeliveryError })}</p>}
        </div>
      )}
      {following && state?.run && <ul><RunLine cron={cron} run={state.run} live /></ul>}
      {!canRuns ? (
        <p className={`${note} text-ink-soft`}>{t('Historique indisponible sur cette instance (dashboard requis)')}</p>
      ) : runs.isLoading ? (
        <p className={`${note} text-ink-faint`}>{t('Chargement…')}</p>
      ) : history.length === 0 && !following ? (
        <p className={`${note} text-ink-soft`}>{t('Aucune exécution pour l’instant : « Lancer maintenant » en déclenche une tout de suite.')}</p>
      ) : (
        <ul>{history.map((r) => <RunLine key={r.id} cron={cron} run={r} />)}</ul>
      )}
      <div className="empty:hidden px-4 pb-3"><ErrorText error={runs.error} /></div>
    </section>
  );
}
