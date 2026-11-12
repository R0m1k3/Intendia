import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MessageSquareReply, Square, X } from 'lucide-react';
import { useState } from 'react';
import { api, type ActiveRun, type KanbanWorker } from '../api';
import { useCurrentInstance } from '../instance/current';
import { PageHeader } from '../components/Layout';
import { Button, ErrorText, Mark, Panel, Tag, timeAgo } from '../components/ui';
import { ask } from '../components/Dialog';

const ICON = 'size-4';
const POLL_MS = 5_000;

const RUN_STATUS: Record<string, string> = {
  queued: 'en attente', running: 'en cours', waiting_for_approval: 'attend votre accord', stopping: 'arrêt en cours',
};

function RunRow({ run, instanceLabel }: { run: ActiveRun; instanceLabel: string | null }) {
  const qc = useQueryClient();
  const stop = useMutation({
    mutationFn: () => api.stop(run.instance, run.sessionId, run.runId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
  const waiting = run.status === 'waiting_for_approval';
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3 text-sm">
      <Mark state="readonly" className={waiting ? undefined : 'animate-pulse'} />
      <div className="min-w-0 flex-1">
        <Link to="/w/$slug/s/$sessionId" params={{ slug: run.workspace, sessionId: run.sessionId }} className="font-medium hover:text-accent-ink">
          {run.title || 'Session sans titre'}
        </Link>
        <p className="text-[13px] text-ink-faint">
          {run.workspaceName}{instanceLabel ? ` · ${instanceLabel}` : ''}{run.profile !== 'default' ? ` · ${run.profile}` : ''} · {timeAgo(run.lastActiveAt)}
        </p>
      </div>
      <Tag className={waiting ? 'bg-warn-soft text-warn' : undefined}>{RUN_STATUS[run.status] ?? run.status}</Tag>
      {waiting ? (
        <Link to="/w/$slug/s/$sessionId" params={{ slug: run.workspace, sessionId: run.sessionId }}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-accent-strong bg-accent px-3 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-strong">
          <MessageSquareReply className={ICON} strokeWidth={1.5} />Répondre
        </Link>
      ) : (
        <Button className="h-8" disabled={stop.isPending || run.status === 'stopping'}
          onClick={async () => { if (await ask({ title: 'Arrêter ce run ?', message: 'La réponse en cours sera interrompue.', confirmLabel: 'Arrêter', danger: true })) stop.mutate(); }}>
          <Square className="size-3.5" strokeWidth={1.5} />Arrêter
        </Button>
      )}
      {stop.error && <div className="w-full"><ErrorText error={stop.error} /></div>}
    </li>
  );
}

function WorkerRow({ worker, instanceLabel, onStopped }: { worker: KanbanWorker; instanceLabel: string | null; onStopped: (text: string) => void }) {
  const qc = useQueryClient();
  const title = worker.taskTitle ?? worker.taskId;
  const stop = useMutation({
    mutationFn: () => api.stopWorker(worker.instance, worker.board, worker.runId),
    // the row leaves the list on the next read: the outcome is shown by the page
    onSuccess: (r) => onStopped(`« ${title} » arrêtée : ${r.status === 'blocked' ? 'la tâche est bloquée' : r.status === 'review' ? 'la tâche est en revue' : `statut ${r.status}`}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3 text-sm">
      <Mark state="readonly" className="animate-pulse" />
      <div className="min-w-0 flex-1">
        <Link to="/i/$inst/kanban" params={{ inst: worker.instance }} search={{ board: worker.board, task: worker.taskId }} className="block truncate font-medium hover:text-accent-ink">
          {title}
        </Link>
        <p className="text-[13px] text-ink-faint">
          {worker.assignee ?? 'agent inconnu'} · tableau <span className="font-mono">{worker.board}</span>{instanceLabel ? ` · ${instanceLabel}` : ''}
          {worker.startedAt ? ` · ${timeAgo(worker.startedAt * 1000)}` : ''}
        </p>
      </div>
      <Button className="h-8" disabled={stop.isPending || stop.isSuccess}
        onClick={async () => { if (await ask({ title: 'Arrêter ce worker ?', message: 'La tâche passera en Bloquée, ou restera en Revue ; Débloquer la relancera.', confirmLabel: 'Arrêter', danger: true })) stop.mutate(); }}>
        <Square className="size-3.5" strokeWidth={1.5} />Arrêter
      </Button>
      {stop.error && <div className="w-full"><ErrorText error={stop.error} /></div>}
    </li>
  );
}

export function ActivityPage() {
  const { id: inst, instance, instances } = useCurrentInstance();
  const activity = useQuery({ queryKey: ['activity', inst], queryFn: () => api.activity(inst!), enabled: inst !== null, refetchInterval: POLL_MS, staleTime: 0 });
  // one instance per page: its name is in the subtitle, not on each line
  const label = (_id: string): string | null => null;
  const data = activity.data;
  const [stopped, setStopped] = useState<string[]>([]);

  return (
    <div>
      <PageHeader title="Activité" subtitle={`Runs lancés depuis Intendia ces dernières 24 h, et tâches du kanban en cours${instance && instances.length > 1 ? `, sur ${instance.label}` : ''}.`} />
      <div className="max-w-[1000px] space-y-5 px-4 pb-14 md:px-8">
        <ErrorText error={activity.error} />
        {stopped.length > 0 && (
          <ul role="status" className="space-y-1.5 card px-4 py-3">
            {stopped.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-ink-soft">
                <Mark state="unavailable" /><span className="min-w-0 flex-1">{t}</span>
                <button type="button" className="text-ink-faint hover:text-ink" aria-label="Masquer" onClick={() => setStopped((l) => l.filter((_, j) => j !== i))}>
                  <X className="size-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {data?.errors.map((e) => (
          <p key={`${e.instance}:${e.message}`} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {label(e.instance) ?? e.instance} : {e.message}
          </p>
        ))}
        <Panel bodyClassName="p-0" title="Conversations" action={<span className="font-mono text-xs text-ink-faint">{data?.runs.length ?? ''}</span>}>
          {data?.runs.length ? (
            <ul className="divide-y divide-line/70 border-t border-line/70">
              {data.runs.map((r) => <RunRow key={`${r.instance}:${r.runId}`} run={r} instanceLabel={label(r.instance)} />)}
            </ul>
          ) : (
            <p className="border-t border-line/70 px-4 py-5 text-sm text-ink-faint">{data ? 'Aucune réponse en cours' : 'Chargement…'}</p>
          )}
        </Panel>
        <Panel bodyClassName="p-0" title="Workers du kanban" action={<span className="font-mono text-xs text-ink-faint">{data?.workers.length ?? ''}</span>}>
          {data?.workers.length ? (
            <ul className="divide-y divide-line/70 border-t border-line/70">
              {data.workers.map((w) => <WorkerRow key={`${w.instance}:${w.board}:${w.runId}`} worker={w} instanceLabel={label(w.instance)}
                onStopped={(t) => setStopped((l) => [...l, t])} />)}
            </ul>
          ) : (
            <p className="border-t border-line/70 px-4 py-5 text-sm text-ink-faint">{data ? 'Aucune tâche en cours' : 'Chargement…'}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
