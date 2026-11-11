import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Cpu, Pencil, Puzzle, SlidersHorizontal } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { api, type PublicInstance } from '../api';
import { DetailBody, DetailHeader, Facts } from '../components/Panes';
import { Button, cx, ErrorText, Mark, timeAgo } from '../components/ui';
import { keyHint } from './keyHint';

const CodeView = lazy(() => import('../files/CodeView'));
const ICON = 'size-4';
const BTN = 'inline-flex h-[34px] items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-[13.5px] font-medium transition-colors';
const LINK = `${BTN} border-line bg-sheet text-ink hover:bg-paper`;
const DARK = `${BTN} border-ink bg-ink text-sheet hover:opacity-90`;

function Description({ inst, name, text, editable }: { inst: string; name: string; text: string; editable: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
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
      <div className="flex items-start gap-3">
        <p className={cx('min-w-0 flex-1 whitespace-pre-wrap text-[15px]', text ? 'text-ink' : 'text-ink-faint')}>{text || 'Pas de description'}</p>
        {editable && (
          <Button variant="ghost" className="h-8 px-2" onClick={() => setDraft(text)} aria-label="Modifier la description">
            <Pencil className={ICON} strokeWidth={1.5} />
          </Button>
        )}
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

/** The detail of one agent (Hermes profile): facts, description, kanban workers, SOUL.md. */
export function AgentDetail({ inst, name, instance, canEdit, available, back }: {
  inst: string; name: string; instance?: PublicInstance; canEdit: boolean; available: boolean; back: boolean;
}) {
  const agent = useQuery({ queryKey: ['agent', inst, name], queryFn: () => api.agent(inst, name).then((r) => r.agent), enabled: available });
  const [soulOpen, setSoulOpen] = useState(false);
  const x = agent.data;

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
        {!x && !agent.error && <p className="text-sm text-ink-faint">Chargement…</p>}
        {x && (
          <>
            {!x.hasKey && instance && (
              <p className="rounded-[10px] bg-warn-soft px-4 py-3 text-[13.5px] text-warn">{keyHint(name, instance.source)}</p>
            )}
            <Facts items={[
              {
                label: 'Modèle', mono: true,
                value: (
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="break-all">{x.model ?? '—'}</span>
                    <Link to="/i/$inst/config" params={{ inst }} search={{ profile: name, tab: 'modeles' }}
                      className="inline-flex items-center gap-1 font-sans text-xs text-ink-soft underline-offset-2 hover:text-ink hover:underline">
                      <Cpu className="size-3.5" strokeWidth={1.5} />Changer le modèle
                    </Link>
                  </span>
                ),
              },
              { label: 'Fournisseur', value: x.provider ?? '—', mono: true },
              { label: 'Instance', value: instance?.label ?? inst },
              { label: 'Skills', value: x.skillCount ?? '—' },
              {
                label: 'Chat depuis Intendia',
                value: <span className={cx('inline-flex items-center gap-2', x.hasKey ? 'text-ink' : 'text-warn')}><Mark state={x.hasKey ? 'full' : 'unavailable'} />{x.hasKey ? 'prêt' : 'clé manquante'}</span>,
              },
              ...(x.gatewayRunning !== null ? [{ label: 'Passerelle', value: x.gatewayRunning ? 'en marche' : 'arrêtée' }] : []),
            ]} />

            <section aria-labelledby="ag-desc">
              <h3 id="ag-desc" className="text-[15px] font-semibold">Description</h3>
              <p className="mb-2 mt-0.5 text-[13px] text-ink-faint">Le kanban s’en sert pour confier des tâches à cet agent</p>
              <Description inst={inst} name={name} text={x.description} editable={canEdit} />
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

            {x.soul !== null && (
              <section className="card overflow-hidden">
                <button type="button" onClick={() => setSoulOpen((o) => !o)} aria-expanded={soulOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <span className="min-w-0">
                    <span className="font-mono text-[13.5px] font-medium">SOUL.md</span>
                    <span className="ml-3 text-xs text-ink-faint">personnalité de l’agent, en lecture ; les valeurs qui ressemblent à des secrets sont masquées</span>
                  </span>
                  <ChevronDown className={cx('size-4 shrink-0 text-ink-faint transition-transform', soulOpen && 'rotate-180')} strokeWidth={1.5} />
                </button>
                {soulOpen && (
                  <div className="border-t border-line/70">
                    {x.soul ? (
                      <Suspense fallback={<p className="px-4 py-3 text-sm text-ink-faint">Chargement…</p>}>
                        <CodeView name="SOUL.md" value={x.soul} editable={false} />
                      </Suspense>
                    ) : <p className="px-4 py-3 text-sm text-ink-faint">SOUL.md vide</p>}
                    {x.soulTruncated && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">Tronqué à 64 Kio</p>}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </DetailBody>
    </>
  );
}
