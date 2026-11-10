import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Download, FolderOpen, Link2, Pencil, ScrollText, Unlink, Wand2, Split } from 'lucide-react';
import { useState } from 'react';
import { api, kanbanPath, type KanbanTask, type KanbanTaskDetail, type KanbanTaskPatch, type KanbanWorkflow } from '../api';
import { Button, cx, ErrorText, Field, Input, Mark, timeAgo } from '../components/ui';
import { moveTargets, statusLabel } from './moves';
import { Sheet, SELECT, TEXTAREA } from './Sheet';

const ICON = 'size-4';
const when = (s: number | null) => (s ? timeAgo(s * 1000) : '');

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-ink-soft">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Title and text, edited together. */
function TextEditor({ task, save, busy }: { task: KanbanTask; save: (p: KanbanTaskPatch) => void; busy: boolean }) {
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  if (!draft) {
    return (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-base font-medium">{task.title}</p>
          <p className={cx('whitespace-pre-wrap text-sm', task.body ? 'text-ink-soft' : 'text-ink-faint')}>{task.body || 'Pas de description'}</p>
        </div>
        <Button variant="ghost" className="h-8 px-2" onClick={() => setDraft({ title: task.title, body: task.body })} aria-label="Modifier la tâche">
          <Pencil className={ICON} strokeWidth={1.5} />
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Titre" autoFocus />
      <textarea value={draft.body} maxLength={20_000} rows={6} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={TEXTAREA} aria-label="Description" />
      <div className="flex justify-end gap-2">
        <Button onClick={() => setDraft(null)}>Annuler</Button>
        <Button variant="primary" disabled={busy || !draft.title.trim()}
          onClick={() => { save({ ...(draft.title !== task.title ? { title: draft.title } : {}), ...(draft.body !== task.body ? { body: draft.body } : {}) }); setDraft(null); }}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

export function TaskPanel({ inst, board, taskId, workflow, assignees, allTasks, onClose, onOpen }: {
  inst: string; board: string; taskId: string; workflow: KanbanWorkflow | undefined; assignees: string[];
  allTasks: KanbanTask[]; onClose: () => void; onOpen: (id: string) => void;
}) {
  const qc = useQueryClient();
  const key = ['kanban-task', inst, board, taskId];
  const detail = useQuery({ queryKey: key, queryFn: () => api.kanbanTask(inst, board, taskId) });
  const [comment, setComment] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const log = useQuery({ queryKey: ['kanban-log', inst, board, taskId], queryFn: () => api.kanbanLog(inst, board, taskId), enabled: showLog });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] });
  };
  const update = useMutation({ mutationFn: (p: KanbanTaskPatch) => api.updateKanbanTask(inst, board, taskId, p), onSettled: refresh });
  const addComment = useMutation({
    mutationFn: () => api.commentKanbanTask(inst, board, taskId, comment),
    onSuccess: () => setComment(''), onSettled: refresh,
  });
  const link = useMutation({ mutationFn: (parent: string) => api.linkKanbanTasks(inst, board, parent, taskId), onSuccess: () => setLinkTo(''), onSettled: refresh });
  const unlink = useMutation({ mutationFn: (r: { parent: string; child: string }) => api.unlinkKanbanTasks(inst, board, r.parent, r.child), onSettled: refresh });
  const aux = useMutation({
    mutationFn: (op: 'specify' | 'decompose') => api.kanbanAux(inst, board, taskId, op),
    onSuccess: (_r, op) => setNotice(op === 'specify' ? 'Tâche précisée par Hermes' : 'Tâche découpée par Hermes'),
    onSettled: refresh,
  });
  const error = update.error ?? addComment.error ?? link.error ?? unlink.error ?? aux.error;

  const d: KanbanTaskDetail | undefined = detail.data;
  const t = d?.task;
  const targets = t && workflow ? moveTargets(workflow.manual, t.status) : [];
  const linked = new Set([taskId, ...(d?.parents.map((p) => p.id) ?? []), ...(d?.children.map((c) => c.id) ?? [])]);
  const candidates = allTasks.filter((x) => !linked.has(x.id));

  return (
    <Sheet title={t ? <span className="flex items-center gap-2"><span className="font-mono text-[12px] text-ink-faint">{t.id}</span>{statusLabel(t.status)}</span> : 'Tâche'}
      onClose={onClose} width="md:w-[560px]">
      <ErrorText error={detail.error ?? error} />
      {notice && <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ink">{notice}</p>}
      {!t ? <p className="text-sm text-ink-faint">Chargement…</p> : (
        <>
          <TextEditor task={t} save={(p) => update.mutate(p)} busy={update.isPending} />

          {t.status === 'blocked' && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">Bloquée{d.blockReason ? ` : ${d.blockReason}` : ''}</span>
              <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate({ status: 'ready' })}>Débloquer</Button>
            </div>
          )}
          {t.error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">Dernier échec : {t.error}</p>}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Statut">
              <select className={SELECT} value="" aria-label="Déplacer vers…" disabled={!targets.length || update.isPending}
                onChange={(e) => e.target.value && update.mutate({ status: e.target.value })}>
                <option value="">{statusLabel(t.status)}</option>
                {targets.map((s) => <option key={s} value={s}>→ {statusLabel(s)}</option>)}
              </select>
            </Field>
            <Field label="Agent">
              <select className={SELECT} value={t.assignee ?? ''} onChange={(e) => update.mutate({ assignee: e.target.value || null })}>
                <option value="">Aucun</option>
                {[...new Set([...(t.assignee ? [t.assignee] : []), ...assignees])].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Priorité">
              <Input type="number" defaultValue={t.priority ?? 0} min={-1000} max={1000} key={`${t.id}:${t.priority}`}
                onBlur={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v) && v !== (t.priority ?? 0)) update.mutate({ priority: v }); }} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={aux.isPending} onClick={() => { setNotice(null); aux.mutate('specify'); }}><Wand2 className={ICON} strokeWidth={1.5} />Préciser</Button>
            <Button disabled={aux.isPending} onClick={() => { setNotice(null); aux.mutate('decompose'); }}><Split className={ICON} strokeWidth={1.5} />Découper</Button>
            {t.workspace && (
              <Link to="/w/$slug/fichiers" params={{ slug: t.workspace.slug }} search={{ path: t.workspace.folder }}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft hover:text-ink">
                <FolderOpen className={ICON} strokeWidth={1.5} />{t.workspace.name}
              </Link>
            )}
          </div>
          {aux.isPending && <p className="text-xs text-ink-faint">Hermes réfléchit (jusqu’à 2 min)…</p>}

          <Section title="Dépendances">
            {d.parents.length + d.children.length === 0 && <p className="text-sm text-ink-faint">Aucune</p>}
            <ul className="space-y-1">
              {[...d.parents.map((p) => ({ ...p, role: 'parent' as const })), ...d.children.map((c) => ({ ...c, role: 'child' as const }))].map((x) => (
                <li key={`${x.role}:${x.id}`} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-ink-faint">{x.role === 'parent' ? 'dépend de' : 'bloque'}</span>
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => onOpen(x.id)}>{x.title ?? x.id}</button>
                  <span className="text-xs text-ink-faint">{x.status ? statusLabel(x.status) : ''}</span>
                  <Button variant="ghost" className="h-7 px-1.5" aria-label="Délier" disabled={unlink.isPending}
                    onClick={() => unlink.mutate(x.role === 'parent' ? { parent: x.id, child: taskId } : { parent: taskId, child: x.id })}>
                    <Unlink className="size-3.5" strokeWidth={1.5} />
                  </Button>
                </li>
              ))}
            </ul>
            {candidates.length > 0 && (
              <div className="flex gap-2">
                <select className={SELECT} value={linkTo} onChange={(e) => setLinkTo(e.target.value)} aria-label="Lier à…">
                  <option value="">Dépend de…</option>
                  {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <Button disabled={!linkTo || link.isPending} onClick={() => link.mutate(linkTo)}><Link2 className={ICON} strokeWidth={1.5} />Lier</Button>
              </div>
            )}
          </Section>

          <Section title={`Commentaires (${d.comments.length})`}>
            <ul className="space-y-2">
              {d.comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-line bg-sheet px-3 py-2 text-sm">
                  <p className="text-xs text-ink-faint">{c.author ?? '?'} · {when(c.createdAt)}</p>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(); }}>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={10_000} className={TEXTAREA}
                placeholder="Un commentaire pour l’agent ou pour vous" aria-label="Commentaire" />
              <div className="flex justify-end"><Button type="submit" disabled={!comment.trim() || addComment.isPending}>Commenter</Button></div>
            </form>
          </Section>

          {d.attachments.length > 0 && (
            <Section title="Pièces jointes">
              <ul className="space-y-1">
                {d.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={`/x${kanbanPath(inst, `attachments/${a.id}`, board)}`} className="inline-flex items-center gap-2 text-sm hover:text-accent" download>
                      <Download className="size-3.5" strokeWidth={1.5} />{a.filename}
                      {a.size !== null && <span className="text-xs text-ink-faint">{Math.ceil(a.size / 1024)} Kio</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.runs.length > 0 && (
            <Section title="Exécutions">
              <ul className="space-y-1.5">
                {d.runs.slice(-5).reverse().map((r) => (
                  <li key={r.id} className="text-sm">
                    <span className="flex items-center gap-2">
                      <Mark state={!r.endedAt ? 'readonly' : r.outcome === 'completed' || r.status === 'completed' ? 'full' : 'unavailable'} />
                      <span className="font-mono text-[12px] text-ink-faint">#{r.id}</span>
                      <span>{r.profile ?? ''}</span>
                      <span className="text-xs text-ink-faint">{r.outcome ?? r.status ?? ''} · {when(r.startedAt)}</span>
                    </span>
                    {(r.error || r.summary) && <p className={cx('ml-5 mt-0.5 text-xs', r.error ? 'text-bad' : 'text-ink-soft')}>{r.error ?? r.summary}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Derniers événements">
            <ul className="space-y-0.5 font-mono text-[12px] text-ink-soft">
              {d.events.slice(-8).reverse().map((e) => <li key={e.id}>{when(e.createdAt)} · {e.kind}</li>)}
            </ul>
          </Section>

          <Section title="Journal du worker" action={
            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShowLog((s) => !s)}>
              <ScrollText className="size-3.5" strokeWidth={1.5} />{showLog ? 'Masquer' : 'Afficher'}
            </Button>
          }>
            {showLog && (log.data ? (
              log.data.exists ? (
                <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-sheet p-3 font-mono text-[11px] whitespace-pre-wrap">
                  {log.data.truncated ? '… (200 dernières lignes)\n' : ''}{log.data.content}
                </pre>
              ) : <p className="text-sm text-ink-faint">Pas encore de journal</p>
            ) : <p className="text-sm text-ink-faint">Chargement…</p>)}
          </Section>
        </>
      )}
    </Sheet>
  );
}
