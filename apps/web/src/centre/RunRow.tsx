import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CornerDownRight, MessageSquareReply, Square } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, type ActiveRun, type KanbanWorker, type WorkingSubagents } from '../api';
import { subagentsLabel } from '../sessions/SessionRow';
import { ask } from '../components/Dialog';
import { useModuleAvailability } from '../components/ModuleNotice';
import { Button, ErrorText, Input, Mark, Tag, timeAgo } from '../components/ui';
import { STEER_REFUSED } from './format';

const ICON = 'size-4';

const RUN_STATUS: Record<string, string> = {
  queued: 'en attente', running: 'en cours', waiting_for_approval: 'attend votre accord', stopping: 'arrêt en cours',
};

export function RunRow({ run, instanceLabel }: { run: ActiveRun; instanceLabel: string | null }) {
  const qc = useQueryClient();
  const stop = useMutation({
    mutationFn: () => api.stop(run.instance, run.sessionId, run.runId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['activity'] }),
  });
  const waiting = run.status === 'waiting_for_approval';
  const { has } = useModuleAvailability(run.instance, 'chat', [], []);
  const [steering, setSteering] = useState(false);
  const canSteer = has('chat', 'steer') && run.status === 'running';
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
        <>
        {canSteer && (
          <Button className="h-8" aria-expanded={steering} onClick={() => setSteering((v) => !v)}>
            <CornerDownRight className="size-3.5" strokeWidth={1.5} />Réorienter
          </Button>
        )}
        <Button className="h-8" disabled={stop.isPending || run.status === 'stopping'}
          onClick={async () => { if (await ask({ title: 'Arrêter ce run ?', message: 'La réponse en cours sera interrompue.', confirmLabel: 'Arrêter', danger: true })) stop.mutate(); }}>
          <Square className="size-3.5" strokeWidth={1.5} />Arrêter
        </Button>
        </>
      )}
      {steering && <Steer run={run} onDone={() => setSteering(false)} />}
      {stop.error && <div className="w-full"><ErrorText error={stop.error} /></div>}
    </li>
  );
}

/** Text given to the agent during its run (after its current tools), without leaving the Centre. */
function Steer({ run, onDone }: { run: ActiveRun; onDone: () => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.steer(run.instance, run.sessionId, run.runId, text.trim()),
    onSuccess: () => { setText(''); setNote('Consigne transmise : l’agent la lira après ses outils en cours.'); setTimeout(onDone, 2500); },
  });
  const refused = send.error instanceof ApiError && send.error.status === 409;
  return (
    <form className="w-full space-y-1.5 pl-6" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
      <div className="flex gap-2">
        <Input autoFocus value={text} onChange={(e) => { setText(e.target.value); setNote(null); }} aria-label="Consigne pour l’agent"
          placeholder="Nouvelle consigne pour l’agent" className="h-8 flex-1" disabled={send.isPending} />
        <Button type="submit" variant="primary" className="h-8" disabled={!text.trim() || send.isPending}>Envoyer</Button>
      </div>
      {note && <p role="status" className="text-[13px] text-ink-soft">{note}</p>}
      {refused ? <p role="alert" className="text-[13px] text-bad">{STEER_REFUSED}</p> : <ErrorText error={send.error} />}
    </form>
  );
}

export function WorkerRow({ worker, instanceLabel, onStopped }: { worker: KanbanWorker; instanceLabel: string | null; onStopped: (text: string) => void }) {
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

/** A session whose background sub-agents still work: no run to stop, the server wakes the agent once they delivered. */
export function SubagentsRow({ item, instanceLabel }: { item: WorkingSubagents; instanceLabel: string | null }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3 text-sm" data-centre-subagents={item.sessionId}>
      <Mark state="readonly" className="animate-pulse" />
      <div className="min-w-0 flex-1">
        <Link to="/w/$slug/s/$sessionId" params={{ slug: item.workspace, sessionId: item.sessionId }} className="font-medium hover:text-accent-ink">
          {item.title || 'Session sans titre'}
        </Link>
        <p className="text-[13px] text-ink-faint">
          {item.workspaceName}{instanceLabel ? ` · ${instanceLabel}` : ''}{item.profile !== 'default' ? ` · ${item.profile}` : ''}
          {item.since !== null ? ` · lancés ${timeAgo(item.since * 1000)}` : ''} · l’agent reprendra à leur fin
        </p>
      </div>
      <Tag>{subagentsLabel(item.tasks)}</Tag>
    </li>
  );
}
