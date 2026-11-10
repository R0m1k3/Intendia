import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { AlertTriangle, FolderOpen, GitBranch, MessageSquare, Play, Plus, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type KanbanBoardView, type KanbanColumn, type KanbanStart, type KanbanTask, type KanbanWorkflow } from '../api';
import { PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Field, Input, Mark } from '../components/ui';
import { canMove, moveLocally, moveTargets, statusLabel } from '../kanban/moves';
import { Sheet, SELECT, TEXTAREA } from '../kanban/Sheet';
import { TaskPanel } from '../kanban/TaskPanel';
import { POLL_MS, useKanbanLive } from '../kanban/useLive';

const REQUIRED: OpRef[] = [['kanban', 'board'], ['kanban', 'boards'], ['kanban', 'workflow']];
const OPTIONAL: OptionalOp[] = [
  ['kanban', 'createTask', 'Créer une tâche'], ['kanban', 'updateTask', 'Déplacer et modifier'], ['kanban', 'dispatch', 'Répartir'],
  ['kanban', 'createBoard', 'Nouveau tableau'], ['kanban', 'setOrchestration', 'Orchestration'],
];
const ICON = 'size-4';
const BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface KanbanSearch { board?: string; task?: string }

/** One copy of the board in the DOM: all columns side by side from 768 px, one column with tabs below. */
function useWide(): boolean {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

// ---------------------------------------------------------------- card

function Card({ task, targets, onOpen, onMove, draggable }: {
  task: KanbanTask; targets: string[]; onOpen: () => void; onMove: (to: string) => void; draggable: boolean;
}) {
  const running = task.status === 'running';
  return (
    <li draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/x-kanban-task', task.id); e.dataTransfer.setData(`text/x-from-${task.status}`, ''); e.dataTransfer.effectAllowed = 'move'; }}
      className={cx('group rounded-xl border border-line bg-sheet px-3 py-2.5 text-sm shadow-[0_1px_0_var(--color-line)]', draggable && 'cursor-grab active:cursor-grabbing')}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <span className="flex items-start gap-2">
          {running && <Mark state="readonly" className="mt-1 animate-pulse" />}
          <span className="min-w-0 flex-1 font-medium leading-snug group-hover:text-accent">{task.title}</span>
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className={task.assignee ? 'text-ink-soft' : undefined}>{task.assignee ?? 'sans agent'}</span>
          {task.priority ? <span className="font-mono">p{task.priority}</span> : null}
          {task.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" strokeWidth={1.5} />{task.commentCount}</span>}
          {task.parents + task.children > 0 && <span className="inline-flex items-center gap-1"><GitBranch className="size-3" strokeWidth={1.5} />{task.parents + task.children}</span>}
          {task.progress && <span className="font-mono">{task.progress.done}/{task.progress.total}</span>}
          {task.workspace && <span className="inline-flex items-center gap-1 text-ink-soft"><FolderOpen className="size-3" strokeWidth={1.5} />{task.workspace.name}</span>}
        </span>
        {task.error && <span className="mt-1.5 flex items-start gap-1 text-xs text-bad"><AlertTriangle className="mt-0.5 size-3 shrink-0" strokeWidth={1.5} /><span className="line-clamp-2">{task.error}</span></span>}
      </button>
      {targets.length > 0 && (
        <select value="" onChange={(e) => e.target.value && onMove(e.target.value)} aria-label={`Déplacer « ${task.title} » vers…`}
          className="mt-2 h-7 w-full rounded-md border border-line bg-paper px-1.5 text-xs text-ink-soft focus:border-accent focus:outline-none md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100">
          <option value="">Déplacer vers…</option>
          {targets.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      )}
    </li>
  );
}

function Column({ col, workflow, canWrite, dragging, onOpen, onMove }: {
  col: KanbanColumn; workflow: KanbanWorkflow; canWrite: boolean; dragging: string | null;
  onOpen: (id: string) => void; onMove: (id: string, from: string, to: string) => void;
}) {
  const [over, setOver] = useState(false);
  const accepts = dragging !== null && col.dragTarget && canMove(workflow.manual, dragging, col.key);
  return (
    <section aria-label={statusLabel(col.key, col.label)}
      onDragOver={(e) => { if (accepts) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('text/x-kanban-task');
        if (id && accepts && dragging) onMove(id, dragging, col.key);
      }}
      className={cx('flex w-full shrink-0 flex-col rounded-2xl border bg-raised/50 md:w-[272px]', over ? 'border-accent' : accepts ? 'border-accent/40 border-dashed' : 'border-transparent',
        dragging !== null && !accepts && 'opacity-60')}>
      <header className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-[13px] font-medium">{statusLabel(col.key, col.label)}</h2>
        <span className="font-mono text-[11px] text-ink-faint">{col.tasks.length}</span>
      </header>
      <ul className="min-h-16 space-y-2 px-2 pb-3" data-status={col.key}>
        {col.tasks.map((t) => (
          <Card key={t.id} task={t} draggable={canWrite && moveTargets(workflow.manual, t.status).length > 0}
            targets={canWrite ? moveTargets(workflow.manual, t.status) : []}
            onOpen={() => onOpen(t.id)} onMove={(to) => onMove(t.id, t.status, to)} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- dialogs

function NewBoard({ inst, onClose, onCreated }: { inst: string; onClose: () => void; onCreated: (slug: string) => void }) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.createKanbanBoard(inst, slug, name.trim() || undefined),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['kanban-boards', inst] }); onCreated(slug); },
  });
  const ok = BOARD_RE.test(slug);
  return (
    <Sheet title="Nouveau tableau" onClose={onClose} onSubmit={() => ok && create.mutate()}
      footer={<><Button type="button" onClick={onClose}>Annuler</Button><Button type="submit" variant="primary" disabled={!ok || create.isPending}>Créer le tableau</Button></>}>
      <Field label="Nom"><Input value={name} maxLength={100} onChange={(e) => { setName(e.target.value); if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value)); }} placeholder="Ventes" autoFocus /></Field>
      <Field label="Identifiant" hint="Minuscules, chiffres, - et _ ; ne change plus ensuite">
        <Input value={slug} maxLength={64} onChange={(e) => setSlug(e.target.value)} placeholder="ventes" aria-invalid={slug !== '' && !ok} />
      </Field>
      <ErrorText error={create.error} />
    </Sheet>
  );
}

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

// No "todo" start: Hermes promotes a todo task without unfinished parents to ready at once. "Planifiée" is the
// state it leaves alone.
const START: { value: KanbanStart; label: string }[] = [
  { value: 'scheduled', label: 'Planifiée (rien ne se lance)' },
  { value: 'ready', label: 'Prête à lancer' },
  { value: 'triage', label: 'Triage' },
];

function startHint(start: KanbanStart, agent: boolean, autoDecompose: boolean): string {
  if (start === 'scheduled') return 'Elle attend que vous la passiez en « Prête à lancer »';
  if (start === 'triage') {
    return autoDecompose
      ? 'Hermes la découpera et lancera les morceaux s’il a un modèle auxiliaire (orchestration « découper automatiquement »)'
      : 'Elle attend d’être précisée ou découpée depuis son panneau';
  }
  return agent
    ? 'Le répartiteur la lancera à son prochain passage (toutes les 60 s) ou avec « Répartir »'
    : 'Sans agent, rien ne se lance : elle attend que vous en choisissiez un';
}

function NewTask({ inst, board, assignees, autoDecompose, onClose, onCreated }: {
  inst: string; board: string; assignees: string[]; autoDecompose: boolean; onClose: () => void; onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const mine = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === inst);
  const [f, setF] = useState({ title: '', body: '', assignee: '', priority: 0, start: 'scheduled' as KanbanStart, workspace: '' });
  const create = useMutation({
    mutationFn: () => api.createKanbanTask(inst, board, {
      title: f.title.trim(), body: f.body || undefined, assignee: f.assignee || null, priority: f.priority || null, start: f.start, workspace: f.workspace || null,
    }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] }); onCreated(r.task.id); },
  });
  return (
    <Sheet title="Nouvelle tâche" onClose={onClose} onSubmit={() => f.title.trim() && create.mutate()}
      footer={<><Button type="button" onClick={onClose}>Annuler</Button><Button type="submit" variant="primary" disabled={!f.title.trim() || create.isPending}>Créer la tâche</Button></>}>
      <Field label="Titre"><Input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Comparer les ventes de mars" autoFocus required /></Field>
      <Field label="Description" hint="Ce que l’agent doit faire et rendre">
        <textarea value={f.body} maxLength={20_000} rows={5} onChange={(e) => setF({ ...f, body: e.target.value })} className={TEXTAREA} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent">
          <select className={SELECT} value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}>
            <option value="">Aucun</option>
            {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Priorité"><Input type="number" min={-1000} max={1000} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.valueAsNumber || 0 })} /></Field>
      </div>
      <Field label="État de départ" hint={startHint(f.start, Boolean(f.assignee), autoDecompose)}>
        <select className={SELECT} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value as KanbanStart })}>
          {START.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Workspace (facultatif)" hint="L’agent travaillera dans un dossier kanban/… de ce workspace">
        <select className={SELECT} value={f.workspace} onChange={(e) => setF({ ...f, workspace: e.target.value })}>
          <option value="">Aucun</option>
          {mine.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
        </select>
      </Field>
      <ErrorText error={create.error} />
    </Sheet>
  );
}

function Dispatch({ inst, board, onClose }: { inst: string; board: string; onClose: () => void }) {
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ['kanban-dispatch', inst, board], queryFn: () => api.dispatchKanban(inst, board, true), staleTime: 0, gcTime: 0 });
  const run = useMutation({
    mutationFn: () => api.dispatchKanban(inst, board, false),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] }),
  });
  const p = run.data ?? preview.data;
  return (
    <Sheet title="Répartir les tâches prêtes" onClose={onClose}
      footer={run.data ? <Button onClick={onClose}>Fermer</Button> : <>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="primary" disabled={!preview.data || run.isPending} onClick={() => run.mutate()}><Play className={ICON} strokeWidth={1.5} />Lancer</Button>
      </>}>
      <ErrorText error={preview.error ?? run.error} />
      {!p ? <p className="text-sm text-ink-faint">Calcul de la répartition…</p> : (
        <>
          <p className="text-sm">{run.data ? 'Lancées' : 'Hermes lancerait'} : <span className="font-medium">{p.spawned.length}</span> tâche{p.spawned.length > 1 ? 's' : ''} (8 au plus).</p>
          <ul className="space-y-1 text-sm">
            {p.spawned.map((s) => <li key={s.taskId} className="flex gap-2"><span className="font-mono text-[12px] text-ink-faint">{s.taskId}</span>{s.assignee}</li>)}
          </ul>
          {p.skippedUnassigned.length > 0 && <p className="text-sm text-ink-soft">{p.skippedUnassigned.length} tâche(s) prête(s) sans agent, laissée(s) de côté.</p>}
          {!run.data && <p className="text-xs text-ink-faint">Hermes répartit aussi tout seul chaque minute : d’ici votre confirmation, il peut en avoir lancé d’autres.</p>}
        </>
      )}
    </Sheet>
  );
}

function Orchestration({ inst, assignees, onClose }: { inst: string; assignees: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const o = useQuery({ queryKey: ['kanban-orchestration', inst], queryFn: () => api.kanbanOrchestration(inst) });
  const [f, setF] = useState<{ orchestrator: string; assignee: string; decompose: boolean; promote: boolean } | null>(null);
  useEffect(() => {
    if (o.data && !f) setF({ orchestrator: o.data.orchestratorProfile ?? '', assignee: o.data.defaultAssignee ?? '', decompose: o.data.autoDecompose, promote: o.data.autoPromoteChildren });
  }, [o.data, f]);
  const save = useMutation({
    mutationFn: () => api.setKanbanOrchestration(inst, { orchestrator_profile: f!.orchestrator, default_assignee: f!.assignee, auto_decompose: f!.decompose, auto_promote_children: f!.promote }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['kanban-orchestration', inst] }); onClose(); },
  });
  const sel = (value: string, set: (v: string) => void, label: string) => (
    <select className={SELECT} value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      <option value="">Aucun (Hermes choisit)</option>
      {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
  return (
    <Sheet title="Orchestration" onClose={onClose} onSubmit={() => f && save.mutate()}
      footer={<><Button type="button" onClick={onClose}>Annuler</Button><Button type="submit" variant="primary" disabled={!f || save.isPending}>Enregistrer</Button></>}>
      <ErrorText error={o.error ?? save.error} />
      {f && (
        <>
          <Field label="Agent orchestrateur" hint="Celui qui découpe les tâches en triage">{sel(f.orchestrator, (v) => setF({ ...f, orchestrator: v }), 'Agent orchestrateur')}</Field>
          <Field label="Agent par défaut" hint="Donné aux tâches prêtes qui n’en ont pas">{sel(f.assignee, (v) => setF({ ...f, assignee: v }), 'Agent par défaut')}</Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={f.decompose} onChange={(e) => setF({ ...f, decompose: e.target.checked })} />
            <span>Découper automatiquement<span className="block text-xs text-ink-faint">Hermes découpe les tâches en triage et lance les morceaux</span></span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={f.promote} onChange={(e) => setF({ ...f, promote: e.target.checked })} />
            <span>Lancer les sous-tâches dès que possible<span className="block text-xs text-ink-faint">Une sous-tâche passe en « prête » quand ses dépendances sont finies</span></span>
          </label>
          <p className="text-xs text-ink-faint">
            Hermes écrit ces réglages dans la configuration de l’agent {o.data?.activeProfile ?? 'default'} ; Intendia en garde une copie (onglet Historique de la Configuration).
          </p>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- page

export function KanbanPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as KanbanSearch;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'kanban', REQUIRED, OPTIONAL);
  const boards = useQuery({ queryKey: ['kanban-boards', inst], queryFn: () => api.kanbanBoards(inst).then((r) => r.boards), enabled: a.available });
  const board = search.board ?? boards.data?.[0]?.slug;
  const live = useKanbanLive(inst, a.available ? board : undefined, search.task);
  const view = useQuery({
    queryKey: ['kanban-board', inst, board], queryFn: () => api.kanbanBoard(inst, board!), enabled: a.available && Boolean(board),
    refetchInterval: live.polling ? POLL_MS : false,
  });
  const workflow = useQuery({ queryKey: ['kanban-workflow', inst], queryFn: () => api.kanbanWorkflow(inst), enabled: a.available, staleTime: 300_000 });
  const assignees = useQuery({ queryKey: ['kanban-assignees', inst], queryFn: () => api.kanbanAssignees(inst).then((r) => r.assignees), enabled: a.available });
  const orch = useQuery({ queryKey: ['kanban-orchestration', inst], queryFn: () => api.kanbanOrchestration(inst), enabled: a.available && a.has('kanban', 'orchestration') });
  const [dialog, setDialog] = useState<'board' | 'task' | 'dispatch' | 'orchestration' | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<string>('ready');
  const [moveError, setMoveError] = useState<unknown>(null);
  const wide = useWide();

  const go = (s: KanbanSearch) => void navigate({ to: '/i/$inst/kanban', params: { inst }, search: { board: s.board ?? board, task: s.task } });
  const key = ['kanban-board', inst, board];
  const move = useMutation({
    mutationFn: (m: { id: string; to: string }) => api.updateKanbanTask(inst, board!, m.id, { status: m.to }),
    onMutate: async (m) => {
      setMoveError(null);
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<KanbanBoardView>(key);
      if (before) qc.setQueryData<KanbanBoardView>(key, { ...before, columns: moveLocally(before.columns, m.id, m.to) });
      return { before };
    },
    // Hermes refused: the card goes back, with Hermes' message
    onError: (err, _m, ctx) => { if (ctx?.before) qc.setQueryData(key, ctx.before); setMoveError(err); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const list = instances.data?.instances ?? [];
  const current = list.find((i) => i.id === inst);
  const can = (op: string) => a.has('kanban', op);
  const columns = view.data?.columns ?? [];
  const allTasks = useMemo(() => columns.flatMap((c) => c.tasks), [columns]);
  const wf = workflow.data;
  const shownCol = columns.find((c) => c.key === mobileCol) ?? columns[0];

  return (
    <div onDragStart={(e) => {
      const from = [...e.dataTransfer.types].find((t) => t.startsWith('text/x-from-'));
      setDragging(from ? from.slice('text/x-from-'.length) : null);
    }} onDragEnd={() => setDragging(null)} onDrop={() => setDragging(null)}>
      <PageHeader
        title="Kanban"
        subtitle={<>Le tableau de tâches de {current ? <span className="text-ink">{current.label}</span> : 'l’instance'}, commun à tous ses agents.{live.polling ? ' Mise à jour toutes les 5 s.' : ''}</>}
        action={a.available && board ? (
          <div className="flex flex-wrap gap-2">
            {can('setOrchestration') && <Button onClick={() => setDialog('orchestration')}><Settings2 className={ICON} strokeWidth={1.5} />Orchestration</Button>}
            {can('dispatch') && <Button onClick={() => setDialog('dispatch')}><Play className={ICON} strokeWidth={1.5} />Répartir</Button>}
            {can('createTask') && <Button variant="primary" onClick={() => setDialog('task')}><Plus className={ICON} strokeWidth={1.5} />Nouvelle tâche</Button>}
          </div>
        ) : undefined}
      />
      <div className="space-y-5 pb-10">
        <div className="space-y-4 px-5 md:px-8">
          {list.length > 1 && (
            <nav className="flex flex-wrap gap-1.5" aria-label="Instance">
              {list.map((i) => (
                <Link key={i.id} to="/i/$inst/kanban" params={{ inst: i.id }}
                  className={cx('h-8 rounded-lg border px-3 text-[13px] leading-8 transition-colors', i.id === inst ? 'border-accent text-ink' : 'border-line text-ink-soft hover:text-ink')}>
                  {i.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="empty:hidden">
            <ModuleNotice instanceId={inst} module="kanban" title="Le kanban" required={REQUIRED} optional={OPTIONAL} />
          </div>
          {a.available && (
            <div className="flex flex-wrap items-center gap-2">
              <select className={cx(SELECT.replace('w-full', 'w-auto'), 'min-w-48')} value={board ?? ''} onChange={(e) => go({ board: e.target.value })} aria-label="Tableau">
                {(boards.data ?? []).map((b) => <option key={b.slug} value={b.slug}>{b.name} ({b.slug === board && view.data ? columns.reduce((n, c) => n + c.tasks.length, 0) : b.total})</option>)}
              </select>
              {can('createBoard') && <Button variant="ghost" onClick={() => setDialog('board')}><Plus className={ICON} strokeWidth={1.5} />Nouveau tableau</Button>}
            </div>
          )}
          <ErrorText error={boards.error ?? view.error ?? workflow.error ?? moveError} />
        </div>

        {a.available && wf && view.data && (
          <>
            {!wide ? (
              <div className="space-y-3 px-5">
                <div className="-mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Colonnes">
                  {columns.map((c) => (
                    <button key={c.key} type="button" role="tab" aria-selected={c.key === shownCol?.key} onClick={() => setMobileCol(c.key)}
                      className={cx('h-8 shrink-0 rounded-lg border px-3 text-[13px]', c.key === shownCol?.key ? 'border-accent text-ink' : 'border-line text-ink-soft')}>
                      {statusLabel(c.key, c.label)} <span className="font-mono text-[11px] text-ink-faint">{c.tasks.length}</span>
                    </button>
                  ))}
                </div>
                {shownCol && <Column col={shownCol} workflow={wf} canWrite={can('updateTask')} dragging={null} onOpen={(id) => go({ task: id })} onMove={(id, _f, to) => move.mutate({ id, to })} />}
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto px-8 pb-4" aria-label="Colonnes">
                {columns.map((c) => (
                  <Column key={c.key} col={c} workflow={wf} canWrite={can('updateTask')} dragging={dragging}
                    onOpen={(id) => go({ task: id })} onMove={(id, _from, to) => move.mutate({ id, to })} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {dialog === 'board' && <NewBoard inst={inst} onClose={() => setDialog(null)} onCreated={(slug) => { setDialog(null); go({ board: slug }); }} />}
      {dialog === 'task' && board && (
        <NewTask inst={inst} board={board} assignees={assignees.data ?? []} autoDecompose={orch.data?.autoDecompose ?? false}
          onClose={() => setDialog(null)} onCreated={(id) => { setDialog(null); go({ task: id }); }} />
      )}
      {dialog === 'dispatch' && board && <Dispatch inst={inst} board={board} onClose={() => setDialog(null)} />}
      {dialog === 'orchestration' && <Orchestration inst={inst} assignees={assignees.data ?? []} onClose={() => setDialog(null)} />}
      {search.task && board && (
        <TaskPanel key={search.task} inst={inst} board={board} taskId={search.task} workflow={wf} assignees={assignees.data ?? []} allTasks={allTasks} polling={live.polling}
          onClose={() => go({ task: undefined })} onOpen={(id) => go({ task: id })} />
      )}
    </div>
  );
}
