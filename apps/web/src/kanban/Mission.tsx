import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type KanbanMission, type KanbanMissionChild } from '../api';
import { ask } from '../components/Dialog';
import { Button, cx, ErrorText, Field, Input } from '../components/ui';
import { childNotes, MISSION_STATE, orderChildren } from './mission';
import { statusLabel } from './moves';
import { Sheet, SELECT, TEXTAREA } from './Sheet';

const ICON = 'size-4';

/** One child under review: title, text and agent editable (route of the tasks), « Retirer ». */
function ChildRow({ inst, board, child, all, editable, assignees, onSaved, onRemove, removing }: {
  inst: string; board: string; child: KanbanMissionChild; all: KanbanMissionChild[]; editable: boolean; assignees: string[];
  onSaved: () => Promise<unknown>; onRemove: () => void; removing: boolean;
}) {
  const [draft, setDraft] = useState<{ title: string; body: string; assignee: string } | null>(null);
  const f = draft ?? { title: child.title, body: child.body, assignee: child.assignee ?? '' };
  const save = useMutation({
    mutationFn: () => api.updateKanbanTask(inst, board, child.id, {
      ...(f.title !== child.title ? { title: f.title } : {}),
      ...(f.body !== child.body ? { body: f.body } : {}),
      ...(f.assignee !== (child.assignee ?? '') ? { assignee: f.assignee || null } : {}),
    }),
    onSuccess: async () => { await onSaved(); setDraft(null); },
  });
  const dirty = draft !== null && (f.title !== child.title || f.body !== child.body || f.assignee !== (child.assignee ?? ''));
  const notes = childNotes(child, all, !editable);
  return (
    <li className={cx('space-y-2 rounded-xl border px-3.5 py-3', child.held ? 'border-line bg-sheet' : 'border-line/60 bg-paper')} data-mission-child={child.id}>
      {editable && child.held ? (
        <>
          <Input value={f.title} maxLength={200} aria-label="Titre de la tâche" onChange={(e) => setDraft({ ...f, title: e.target.value })} />
          <textarea value={f.body} maxLength={20_000} rows={3} aria-label="Consigne de la tâche" className={TEXTAREA}
            onChange={(e) => setDraft({ ...f, body: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <select className={cx(SELECT, 'w-auto min-w-40 flex-1')} value={f.assignee} aria-label="Agent de la tâche"
              onChange={(e) => setDraft({ ...f, assignee: e.target.value })}>
              <option value="">Aucun agent</option>
              {[...new Set([...(child.assignee ? [child.assignee] : []), ...assignees])].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {dirty && <Button variant="primary" disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>Enregistrer</Button>}
            <Button variant="ghost" disabled={removing} onClick={onRemove}><Trash2 className={ICON} strokeWidth={1.5} />Retirer</Button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium leading-snug">{child.title}</p>
            {child.body && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink-soft">{child.body}</p>}
          </div>
          <span className="shrink-0 text-xs text-ink-faint">{statusLabel(child.status)}{child.assignee ? ` · ${child.assignee}` : ''}</span>
        </div>
      )}
      {notes.length > 0 && <p className={cx('text-xs', child.lostTracking ? 'text-bad' : 'text-ink-faint')}>{notes.join(' · ')}</p>}
      <ErrorText error={save.error} />
    </li>
  );
}

function Review({ inst, board, mission, assignees }: { inst: string; board: string; mission: KanbanMission; assignees: string[] }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['kanban-mission', inst, mission.id] });
  const remove = useMutation({
    mutationFn: (child: string) => api.removeKanbanMissionChild(inst, mission.id, child),
    onSuccess: (r) => qc.setQueryData(['kanban-mission', inst, mission.id], r),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] }),
  });
  const children = orderChildren(mission.children).filter((c) => c.status !== 'archived');
  const editable = mission.state === 'held';
  return (
    <div className="space-y-3">
      {editable && (
        <p className="text-sm text-ink-soft">
          Hermes a découpé la mission en {children.length} tâche{children.length > 1 ? 's' : ''}. Rien ne part avant « Lancer la mission » :
          relisez, corrigez ou retirez ce qui ne convient pas.
        </p>
      )}
      <ErrorText error={remove.error} />
      <ul className="space-y-2">
        {children.map((c) => (
          <ChildRow key={c.id} inst={inst} board={board} child={c} all={mission.children} editable={editable} assignees={assignees}
            onSaved={refresh} removing={remove.isPending} onRemove={() => remove.mutate(c.id)} />
        ))}
      </ul>
    </div>
  );
}

/** « Nouvelle mission »: a goal split by Hermes, every piece held until the user launches them. */
export function MissionSheet({ inst, board, missionId, assignees, onClose, onCreated }: {
  inst: string; board: string; missionId: string | null; assignees: string[]; onClose: () => void; onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [goal, setGoal] = useState('');
  const [body, setBody] = useState('');
  const key = ['kanban-mission', inst, missionId];
  const mission = useQuery({
    queryKey: key, enabled: Boolean(missionId),
    queryFn: () => api.kanbanMission(inst, missionId!),
    refetchInterval: (q) => (q.state.data?.mission.state === 'decomposing' ? 2000 : q.state.data?.mission.state === 'launched' ? 5000 : false),
  });
  const after = async () => {
    await qc.invalidateQueries({ queryKey: ['kanban-missions', inst, board] });
    await qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] });
  };
  const create = useMutation({
    mutationFn: () => api.createKanbanMission(inst, board, { goal: goal.trim(), body: body.trim() || undefined }),
    onSuccess: async (r) => { await after(); onCreated(r.mission.id); },
  });
  const launch = useMutation({
    mutationFn: () => api.launchKanbanMission(inst, missionId!),
    onSuccess: (r) => qc.setQueryData(key, r),
    onSettled: after,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelKanbanMission(inst, missionId!),
    onSuccess: async () => { await after(); onClose(); },
  });
  const m = mission.data?.mission;
  // the list of the page and the board follow the state seen here (split over, children parked)
  const seen = m?.state;
  useEffect(() => {
    if (seen && seen !== 'decomposing') void after();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  if (!missionId) {
    return (
      <Sheet title="Nouvelle mission" onClose={onClose} onSubmit={() => goal.trim() && create.mutate()} width="md:w-[600px]"
        footer={<><Button type="button" onClick={onClose}>Annuler</Button><Button type="submit" variant="primary" disabled={!goal.trim() || create.isPending}>Découper</Button></>}>
        <p className="text-sm text-ink-soft">
          Hermes découpe le but en 2 à 6 tâches avec son modèle auxiliaire. Intendia les retient toutes : vous les relisez avant que quoi que ce soit parte.
        </p>
        <Field label="But"><Input value={goal} maxLength={200} onChange={(e) => setGoal(e.target.value)} placeholder="Préparer le bilan du trimestre" autoFocus required /></Field>
        <Field label="Consigne (facultatif)" hint="Contexte, contraintes, ce qu’il faut rendre">
          <textarea value={body} maxLength={20_000} rows={5} onChange={(e) => setBody(e.target.value)} className={TEXTAREA} />
        </Field>
        <ErrorText error={create.error} />
      </Sheet>
    );
  }

  const footer = !m ? undefined : m.state === 'held' ? (
    <>
      <Button disabled={cancel.isPending || launch.isPending} onClick={async () => {
        if (await ask({ title: 'Annuler la mission ?', message: 'La tâche racine et les tâches retenues sont archivées chez Hermes.', confirmLabel: 'Annuler la mission', cancelLabel: 'Garder', danger: true })) cancel.mutate();
      }}><X className={ICON} strokeWidth={1.5} />Annuler la mission</Button>
      <Button variant="primary" disabled={launch.isPending || !m.children.some((c) => c.held)} onClick={() => launch.mutate()}>
        <Play className={ICON} strokeWidth={1.5} />Lancer la mission
      </Button>
    </>
  ) : m.state === 'failed' ? (
    <>
      <Button disabled={cancel.isPending} onClick={() => cancel.mutate()}>Retirer la mission</Button>
      <Button onClick={onClose}>Fermer</Button>
    </>
  ) : <Button onClick={onClose}>Fermer</Button>;

  return (
    <Sheet title={m ? <span className="flex min-w-0 items-center gap-2"><span className="truncate">{m.goal}</span><span className="shrink-0 text-xs font-normal text-ink-faint">{MISSION_STATE[m.state]}</span></span> : 'Mission'}
      onClose={onClose} width="md:w-[600px]" footer={footer}>
      <ErrorText error={mission.error ?? launch.error ?? cancel.error} />
      {!m ? <p className="text-sm text-ink-faint">Chargement…</p> : m.state === 'decomposing' ? (
        <div className="space-y-2" role="status">
          <p className="text-sm">Hermes découpe la mission…</p>
          <p className="text-xs text-ink-faint">Jusqu’à 3 min. Vous pouvez fermer : le découpage continue et la mission reste dans la liste du tableau.</p>
        </div>
      ) : m.state === 'failed' ? (
        <div className="space-y-2">
          <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{m.error ?? 'Échec'}</p>
          <p className="text-xs text-ink-faint">« Retirer la mission » archive sa tâche racine{m.rootId ? '' : ' (aucune créée)'}.</p>
        </div>
      ) : (
        <>
          {m.state === 'launched' && <p className="text-sm text-ink-soft">Mission lancée : les tâches partent dès que leurs dépendances sont finies. La tâche racine attend toutes les autres.</p>}
          <Review inst={inst} board={board} mission={m} assignees={assignees} />
        </>
      )}
    </Sheet>
  );
}
