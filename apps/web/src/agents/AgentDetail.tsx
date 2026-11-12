import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Pencil, Puzzle, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { api, ApiError, type AgentDetail as AgentData, type PublicInstance } from '../api';
import { ask, askText } from '../components/Dialog';
import { DetailBody, DetailHeader, Facts } from '../components/Panes';
import { Button, cx, ErrorText, Mark, timeAgo } from '../components/ui';
import { AgentModelPicker } from './AgentModel';
import { Gateway } from './Gateway';
import { keyHint } from './keyHint';

const CodeView = lazy(() => import('../files/CodeView'));
const ICON = 'size-4';
const BTN = 'inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-[13.5px] font-medium transition-colors';
const LINK = `${BTN} border-line bg-sheet text-ink hover:bg-paper`;
const DARK = `${BTN} border-ink bg-ink text-sheet hover:opacity-90`;

function Description({ inst, name, text, editable, canPropose }: { inst: string; name: string; text: string; editable: boolean; canPropose: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [none, setNone] = useState<string | null>(null);
  // Hermes writes the proposal itself when the description is empty (never over an existing one)
  const propose = useMutation({
    mutationFn: () => api.describeAgent(inst, name),
    onSuccess: async (r) => {
      if (!r.description) { setNone(r.reason ? `Aucune description proposée : ${r.reason}` : 'Aucune description proposée'); return; }
      setNone(null);
      if (text) setDraft(r.description);
      await qc.invalidateQueries({ queryKey: ['agent', inst, name] });
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
    },
  });
  const save = useMutation({
    mutationFn: (d: string) => api.setAgentDescription(inst, name, d),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['agent', inst, name] });
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
    },
  });
  if (draft === null) {
    return (
      <div className="space-y-2">
      <div className="flex items-start gap-3">
        <p className={cx('min-w-0 flex-1 whitespace-pre-wrap text-[15px]', text ? 'text-ink' : 'text-ink-faint')}>{text || 'Pas de description'}</p>
        {canPropose && (
          <Button variant="ghost" className="h-8 px-2" onClick={() => propose.mutate()} disabled={propose.isPending} title="Proposée par le modèle auxiliaire d’Hermes (jusqu’à une minute)">
            <Sparkles className={ICON} strokeWidth={1.5} />{propose.isPending ? 'Proposition…' : 'Proposer'}
          </Button>
        )}
        {editable && (
          <Button variant="ghost" className="h-8 px-2" onClick={() => setDraft(text)} aria-label="Modifier la description">
            <Pencil className={ICON} strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {none && <p className="text-[13px] text-ink-faint">{none}</p>}
      <ErrorText error={propose.error} />
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(draft); }}>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} rows={4} autoFocus aria-label="Description"
        className="w-full rounded-[10px] border border-line bg-sheet px-3 py-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none" />
      <ErrorText error={save.error} />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto font-mono text-[11px] text-ink-faint">{draft.length} / 1000</span>
        <Button type="button" onClick={() => setDraft(null)}>Annuler</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

const codeOf = (e: unknown) => (e instanceof ApiError ? (e.data as { code?: string } | undefined)?.code : undefined);

/** SOUL.md: read-only, or edited as masked text (the server puts the masked secrets back). */
function Soul({ inst, name, x, editable }: { inst: string; name: string; x: AgentData; editable: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (d: string) => api.setAgentSoul(inst, name, d),
    onSuccess: async () => { setDraft(null); await qc.invalidateQueries({ queryKey: ['agent', inst, name] }); },
  });
  if (x.soul === null) return null;
  // the editor never gets a cut text: writing it would lose the end
  const canEdit = editable && !x.soulTruncated;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
          <span className="min-w-0">
            <span className="font-mono text-[13.5px] font-medium">SOUL.md</span>
            <span className="ml-3 text-xs text-ink-faint">personnalité de l’agent ; les valeurs qui ressemblent à des secrets sont masquées</span>
          </span>
          <ChevronDown className={cx('size-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} strokeWidth={1.5} />
        </button>
        {canEdit && draft === null && (
          <Button className="h-8" onClick={() => { setOpen(true); setDraft(x.soul ?? ''); }}><Pencil className={ICON} strokeWidth={1.5} />Modifier</Button>
        )}
      </div>
      {open && (
        <div className="border-t border-line/70">
          {draft !== null ? (
            <Suspense fallback={<p className="px-4 py-3 text-sm text-ink-faint">Chargement…</p>}>
              {/* starting text only: CodeView is rebuilt on every value */}
              <CodeView name="SOUL.md" value={x.soul} editable onChange={setDraft} />
            </Suspense>
          ) : x.soul ? (
            <Suspense fallback={<p className="px-4 py-3 text-sm text-ink-faint">Chargement…</p>}>
              <CodeView name="SOUL.md" value={x.soul} editable={false} />
            </Suspense>
          ) : <p className="px-4 py-3 text-sm text-ink-faint">SOUL.md vide</p>}
          {x.soulTruncated && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">Tronqué à 64 Kio : trop long pour l’éditeur</p>}
          {draft !== null && (
            <div className="space-y-2 border-t border-line/70 px-4 py-3">
              <p className="text-xs text-ink-faint">Laissez les «secret:…» tels quels : Intendia remet leur valeur à l’enregistrement.</p>
              <ErrorText error={save.error} />
              <div className="flex justify-end gap-2">
                <Button onClick={() => { setDraft(null); save.reset(); }}>Annuler</Button>
                <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Default model of the agent (its profile config), with the chat's picker. */
function AgentModel({ inst, name, x, editable }: { inst: string; name: string; x: AgentData; editable: boolean }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (c: { model: string; provider: string }) => api.setAgentModel(inst, name, c.provider, c.model),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['agent', inst, name] });
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
      await qc.invalidateQueries({ queryKey: ['chat-models', inst, name] });
    },
  });
  return (
    <span className="flex flex-col items-start gap-1">
      {editable ? (
        <AgentModelPicker inst={inst} profile={name} model={x.model} provider={x.provider} disabled={set.isPending}
          onPick={(c) => { if (c) set.mutate(c); }} />
      ) : <span className="break-all">{x.model ?? '—'}</span>}
      <ErrorText error={set.error} />
    </span>
  );
}

/** The detail of one agent (Hermes profile): facts, gateway, description, kanban workers, SOUL.md, deletion. */
export function AgentDetail({ inst, name, instance, has, available, back }: {
  inst: string; name: string; instance?: PublicInstance; has: (module: string, op: string) => boolean; available: boolean; back: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const agent = useQuery({ queryKey: ['agent', inst, name], queryFn: () => api.agent(inst, name).then((r) => r.agent), enabled: available });
  const [removed, setRemoved] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.deleteAgent(inst, name),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
      await qc.invalidateQueries({ queryKey: ['profiles', inst] });
      if (r.pending) { setRemoved('Suppression en cours chez Hermes : réessayez dans quelques secondes si l’agent reste listé.'); return; }
      if (r.keyLeft) { setRemoved(`Agent supprimé. Retirez sa clé de INTENDIA_INSTANCES (profileKeys.${name}).`); return; }
      void navigate({ to: '/i/$inst/agents', params: { inst } });
    },
  });
  const x = agent.data;
  const canRemove = has('agents', 'remove') && x !== undefined && !x.isDefault;

  const askRemove = async () => {
    const typed = await askText({
      title: `Supprimer l’agent ${name} ?`, confirmLabel: 'Supprimer', label: `Tapez ${name} pour confirmer`,
      message: 'Hermes efface tout son dossier : configuration, skills, mémoire, sessions et clés de ce profil. Rien n’est gardé.',
    });
    if (typed === null) return;
    if (typed !== name) { await ask({ title: 'Nom différent', message: `« ${typed} » n’est pas ${name} : rien n’a été supprimé.`, confirmLabel: 'Fermer' }); return; }
    remove.mutate();
  };
  const inUse = codeOf(remove.error) === 'in_use' ? (remove.error as ApiError).data as { workspaces?: string[]; sessions?: number } : null;

  return (
    <>
      <DetailHeader
        mono
        title={name}
        sub={x?.isDefault ? 'Profil par défaut de l’instance' : 'Profil Hermes'}
        back={back ? { to: '/i/$inst/agents', params: { inst } } : undefined}
        actions={x ? (
          <>
            <Link to="/i/$inst/skills" params={{ inst }} search={{ profile: name }} className={LINK}><Puzzle className={ICON} strokeWidth={1.5} />Skills de cet agent</Link>
            <Link to="/i/$inst/config" params={{ inst }} search={{ profile: name }} className={DARK}><SlidersHorizontal className={ICON} strokeWidth={1.5} />Ouvrir la configuration</Link>
          </>
        ) : undefined}
      />
      <DetailBody>
        <ErrorText error={agent.error} />
        {removed && <p role="status" className="rounded-[10px] bg-ok-soft px-4 py-3 text-[13.5px]">{removed}</p>}
        {!x && !agent.error && <p className="text-sm text-ink-faint">Chargement…</p>}
        {x && !removed && (
          <>
            {!x.hasKey && instance && (
              <p className="rounded-[10px] bg-warn-soft px-4 py-3 text-[13.5px] text-warn">{keyHint(name, instance.source)}</p>
            )}
            <Facts items={[
              { label: 'Modèle', mono: true, value: <AgentModel inst={inst} name={name} x={x} editable={has('agents', 'setModel')} /> },
              { label: 'Fournisseur', value: x.provider ?? '—', mono: true },
              { label: 'Instance', value: instance?.label ?? inst },
              { label: 'Skills', value: x.skillCount ?? '—' },
              {
                label: 'Chat depuis Intendia',
                value: <span className={cx('inline-flex items-center gap-2', x.hasKey ? 'text-ink' : 'text-warn')}><Mark state={x.hasKey ? 'full' : 'unavailable'} />{x.hasKey ? 'prêt' : 'clé manquante'}</span>,
              },
            ]} />

            {(has('config', 'gatewayStart') || has('config', 'gatewayStop') || has('config', 'restartGateway')) && (
              <section aria-labelledby="ag-gw">
                <h3 id="ag-gw" className="text-[15px] font-semibold">Passerelle</h3>
                <p className="mb-2 mt-0.5 text-[13px] text-ink-faint">Elle porte le chat, les runs et les crons de cet agent</p>
                <Gateway inst={inst} profile={name} running={x.gatewayRunning}
                  can={{ start: has('config', 'gatewayStart'), stop: has('config', 'gatewayStop'), restart: has('config', 'restartGateway') }} />
              </section>
            )}

            <section aria-labelledby="ag-desc">
              <h3 id="ag-desc" className="text-[15px] font-semibold">Description</h3>
              <p className="mb-2 mt-0.5 text-[13px] text-ink-faint">Le kanban s’en sert pour confier des tâches à cet agent</p>
              <Description inst={inst} name={name} text={x.description} editable={has('agents', 'setDescription')} canPropose={has('agents', 'describeAuto')} />
            </section>

            <section className="card overflow-hidden" aria-labelledby="ag-workers">
              <div className="flex items-center gap-2.5 px-4 py-3">
                <h3 id="ag-workers" className="text-[15px] font-semibold">Workers en cours</h3>
                <span className="font-mono text-xs text-ink-faint">{x.activeWorkers.length}</span>
              </div>
              {x.activeWorkers.length ? (
                <ul>
                  {x.activeWorkers.map((w) => (
                    <li key={`${w.board}:${w.runId}`} className="flex items-center gap-3.5 border-t border-line/70 px-4 py-3 text-sm">
                      <Mark state="readonly" className="animate-pulse" />
                      <Link to="/i/$inst/kanban" params={{ inst }} search={{ board: w.board, task: w.taskId }} className="min-w-0 flex-1 truncate hover:underline">
                        {w.taskTitle ?? w.taskId}
                      </Link>
                      <span className="font-mono text-[11px] text-ink-faint">{w.board}</span>
                      {w.startedAt && <span className="text-xs text-ink-faint">{timeAgo(w.startedAt * 1000)}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-line/70 px-4 py-3 text-sm text-ink-faint">Aucune tâche du kanban en cours pour cet agent</p>
              )}
            </section>

            <Soul inst={inst} name={name} x={x} editable={has('agents', 'setSoul')} />

            {canRemove && (
              <section className="space-y-2 border-t border-line/70 pt-4" aria-label="Supprimer l’agent">
                <Button onClick={() => void askRemove()} disabled={remove.isPending} className="text-bad">
                  <Trash2 className={ICON} strokeWidth={1.5} />{remove.isPending ? 'Suppression…' : 'Supprimer l’agent'}
                </Button>
                {inUse ? (
                  <p role="alert" className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
                    Agent encore utilisé par Intendia :
                    {inUse.workspaces?.length ? ` workspace${inUse.workspaces.length > 1 ? 's' : ''} ${inUse.workspaces.join(', ')}` : ''}
                    {inUse.workspaces?.length && inUse.sessions ? ' et' : ''}
                    {inUse.sessions ? ` ${inUse.sessions} session${inUse.sessions > 1 ? 's' : ''}` : ''}. Changez leur agent d’abord.
                  </p>
                ) : <ErrorText error={remove.error} />}
              </section>
            )}
          </>
        )}
      </DetailBody>
    </>
  );
}
