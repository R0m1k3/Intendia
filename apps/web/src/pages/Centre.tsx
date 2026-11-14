// Centre (options 60, 61): what waits for you, what is going, what ended in the last 24 h. The current instance by
// default (everything is per instance); « Toutes les instances » widens the three groups to every instance.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { FinishedList } from '../centre/FinishedList';
import { RunRow, SubagentsRow, WorkerRow } from '../centre/RunRow';
import { PageHeader } from '../components/Layout';
import { PendingItem } from '../components/PendingItem';
import { ErrorText, Mark, Panel } from '../components/ui';
import { useCurrentInstance } from '../instance/current';
import { t } from '../i18n';

const POLL_MS = 5_000;
const FINISHED_POLL_MS = 30_000;
const ALL_KEY = 'intendia-centre-all';

function useAllInstances(): [boolean, (v: boolean) => void] {
  const [all, setAll] = useState(() => localStorage.getItem(ALL_KEY) === '1');
  return [all, (v) => { setAll(v); if (v) localStorage.setItem(ALL_KEY, '1'); else localStorage.removeItem(ALL_KEY); }];
}

const count = (n: number | undefined) => <span className="font-mono text-xs text-ink-faint">{n ?? ''}</span>;
const empty = (loaded: boolean, text: string) => (
  <p className="border-t border-line/70 px-4 py-5 text-sm text-ink-faint">{loaded ? text : t('Chargement…')}</p>
);

export function CentrePage() {
  const qc = useQueryClient();
  const { id: inst, instance, instances } = useCurrentInstance();
  const [wantAll, setAll] = useAllInstances();
  const all = wantAll && instances.length > 1;
  const scope = all ? '*' : inst;
  const ready = all || inst !== null;

  const activity = useQuery({
    queryKey: ['activity', scope], queryFn: () => (all ? api.activityAll() : api.activity(inst!)),
    enabled: ready, refetchInterval: POLL_MS, staleTime: 0,
  });
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), refetchInterval: POLL_MS });
  const finished = useQuery({
    queryKey: ['activity-finished', scope], queryFn: () => api.finishedRuns(all ? undefined : inst!),
    enabled: ready, refetchInterval: FINISHED_POLL_MS,
  });
  const [stopped, setStopped] = useState<string[]>([]);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());

  // the instance name on each line only when several are shown
  const label = (id: string): string | null => (all ? instances.find((i) => i.id === id)?.label ?? id : null);
  const data = activity.data;
  // background sub-agents of a session with no run going on (a run of the same session is listed above)
  const subagents = (data?.subagents ?? []).filter((x) => !data?.runs.some((r) => r.instance === x.instance && r.sessionId === x.sessionId));
  const waiting = (approvals.data?.approvals ?? []).filter((a) => (all || a.instanceId === inst) && !answered.has(a.key));
  const subtitle = all ? t('Toutes les instances.') : `${instance && instances.length > 1 ? `${instance.label}. ` : ''}${t('Runs lancés depuis Intendia et tâches du kanban.')}`;

  return (
    <div>
      <PageHeader title={t('Centre')} subtitle={subtitle} action={instances.length > 1 ? (
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
          {t('Toutes les instances')}
        </label>
      ) : undefined} />
      <div className="max-w-[1000px] space-y-5 px-4 pb-14 md:px-8">
        <ErrorText error={activity.error ?? finished.error} />
        {stopped.length > 0 && (
          <ul role="status" className="space-y-1.5 card px-4 py-3">
            {stopped.map((text, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-ink-soft">
                <Mark state="unavailable" /><span className="min-w-0 flex-1">{text}</span>
                <button type="button" className="text-ink-faint hover:text-ink" aria-label={t('Masquer')} onClick={() => setStopped((l) => l.filter((_, j) => j !== i))}>
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {data?.errors.map((e) => (
          <p key={`${e.instance}:${e.message}`} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {instances.find((i) => i.id === e.instance)?.label ?? e.instance} : {e.message}
          </p>
        ))}

        <Panel bodyClassName="p-0" title={t('Vous attend')} action={count(approvals.data ? waiting.length : undefined)}>
          {waiting.length ? (
            <div className="space-y-2 border-t border-line/70 p-3" data-centre-group="waiting">
              {waiting.map((a) => (
                <PendingItem key={a.key} a={a} showInstance={all} onDone={() => {
                  setAnswered((s) => new Set(s).add(a.key));
                  void qc.invalidateQueries({ queryKey: ['approvals'] });
                  void qc.invalidateQueries({ queryKey: ['activity'] });
                }} />
              ))}
            </div>
          ) : empty(Boolean(approvals.data), t('Aucune question en attente'))}
        </Panel>

        <Panel bodyClassName="p-0" title={t('En cours')} action={count(data ? data.runs.length + data.workers.length + subagents.length : undefined)}>
          {data && (data.runs.length || data.workers.length || subagents.length) ? (
            <ul className="divide-y divide-line/70 border-t border-line/70" data-centre-group="running">
              {data.runs.map((r) => <RunRow key={`${r.instance}:${r.runId}`} run={r} instanceLabel={label(r.instance)} />)}
              {subagents.map((x) => <SubagentsRow key={`${x.instance}:${x.sessionId}`} item={x} instanceLabel={label(x.instance)} />)}
              {data.workers.map((w) => <WorkerRow key={`${w.instance}:${w.board}:${w.runId}`} worker={w} instanceLabel={label(w.instance)}
                onStopped={(text) => setStopped((l) => [...l, text])} />)}
            </ul>
          ) : empty(Boolean(data), t('Rien en cours'))}
        </Panel>

        <Panel bodyClassName="p-0" title={t('Terminé')} action={count(finished.data?.runs.length)}>
          {finished.data?.runs.length ? <FinishedList runs={finished.data.runs} instanceLabel={label} />
            : empty(Boolean(finished.data), t('Aucun run terminé'))}
          <p className="border-t border-line/70 px-4 py-2.5 text-[12px] text-ink-faint">
            {t('Dernières 24 h, runs lancés depuis Intendia (pas ceux de Telegram, des crons ni du kanban).')}
          </p>
        </Panel>
      </div>
    </div>
  );
}
