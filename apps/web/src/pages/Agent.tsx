import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, Cpu, Pencil, Puzzle, SlidersHorizontal } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components/Layout';
import { useModuleAvailability, type OpRef } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Mark, Panel, timeAgo } from '../components/ui';
import { keyHint } from './Agents';

const CodeView = lazy(() => import('../files/CodeView'));
const ICON = 'size-4';
const LINK = 'inline-flex h-8 items-center gap-2 rounded-lg border border-line px-3 text-[13px] text-ink-soft transition-colors hover:border-ink-faint/60 hover:text-ink';

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
        <p className={cx('min-w-0 flex-1 whitespace-pre-wrap text-sm', text ? 'text-ink' : 'text-ink-faint')}>{text || 'Pas de description'}</p>
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
        className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors hover:border-ink-faint/60 focus:border-accent focus:outline-none" />
      <ErrorText error={save.error} />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto font-mono text-[11px] text-ink-faint">{draft.length} / 1000</span>
        <Button type="button" onClick={() => setDraft(null)}>Annuler</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

const REQUIRED: OpRef[] = [['agents', 'list']];

export function AgentPage() {
  const { inst, name } = useParams({ strict: false }) as { inst: string; name: string };
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'agents', REQUIRED, []);
  const agent = useQuery({ queryKey: ['agent', inst, name], queryFn: () => api.agent(inst, name).then((r) => r.agent), enabled: a.available });
  const [soulOpen, setSoulOpen] = useState(false);
  const current = instances.data?.instances.find((i) => i.id === inst);
  const x = agent.data;

  const facts: [string, React.ReactNode][] = x ? [
    ['Modèle', <span className="font-mono text-[12px]">{x.model ?? '—'}</span>],
    ['Fournisseur', <span className="font-mono text-[12px]">{x.provider ?? '—'}</span>],
    ['Skills', <span className="font-mono text-[12px]">{x.skillCount ?? '—'}</span>],
    ['Chat depuis Intendia', (
      <span className={cx('inline-flex items-center gap-2', x.hasKey ? 'text-ink' : 'text-warn')}>
        <Mark state={x.hasKey ? 'full' : 'unavailable'} />{x.hasKey ? 'prêt' : 'clé manquante'}
      </span>
    )],
    ...(x.gatewayRunning !== null ? [['Passerelle', x.gatewayRunning ? 'en marche' : 'arrêtée'] as [string, React.ReactNode]] : []),
  ] : [];

  return (
    <div>
      <div className="px-5 pt-6 md:px-8">
        <Link to="/i/$inst/agents" params={{ inst }} className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink">
          <ArrowLeft className="size-3.5" strokeWidth={1.5} />Agents{current && instances.data!.instances.length > 1 ? ` de ${current.label}` : ''}
        </Link>
      </div>
      <PageHeader
        title={name}
        subtitle={x?.isDefault ? 'Profil par défaut de l’instance' : 'Profil Hermes'}
        action={x ? (
          <div className="flex flex-wrap gap-2">
            <Link to="/i/$inst/skills" params={{ inst }} search={{ profile: name }} className={LINK}><Puzzle className={ICON} strokeWidth={1.5} />Skills de cet agent</Link>
            <Link to="/i/$inst/config" params={{ inst }} search={{ profile: name }} className={LINK}><SlidersHorizontal className={ICON} strokeWidth={1.5} />Configuration</Link>
            <Link to="/i/$inst/config" params={{ inst }} search={{ profile: name, tab: 'modeles' }} className={LINK}><Cpu className={ICON} strokeWidth={1.5} />Changer le modèle</Link>
          </div>
        ) : undefined}
      />
      <div className="space-y-6 px-5 pb-10 md:px-8">
        <ErrorText error={agent.error} />
        {!x && !agent.error && <p className="text-sm text-ink-faint">Chargement…</p>}
        {x && (
          <>
            {!x.hasKey && current && (
              <p className="rounded-xl border border-warn/40 bg-warn-soft/40 px-5 py-3 text-sm text-ink-soft">{keyHint(name, current.source)}</p>
            )}
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Panel title="Description">
                <Description inst={inst} name={name} text={x.description} editable={a.has('agents', 'setDescription')} />
              </Panel>
              <Panel title="Fiche" bodyClassName="px-5 py-3">
                <dl className="divide-y divide-line text-sm">
                  {facts.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 py-2">
                      <dt className="text-ink-soft">{k}</dt><dd className="min-w-0 truncate text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            </div>

            <Panel bodyClassName="p-0" title="Workers en cours" action={<span className="font-mono text-[11px] text-ink-faint">{x.activeWorkers.length}</span>}>
              {x.activeWorkers.length ? (
                <ul className="divide-y divide-line">
                  {x.activeWorkers.map((w) => (
                    <li key={`${w.board}:${w.runId}`} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <Mark state="readonly" className="animate-pulse" />
                      <Link to="/i/$inst/kanban" params={{ inst }} search={{ board: w.board, task: w.taskId }} className="min-w-0 flex-1 truncate hover:text-accent">
                        {w.taskTitle ?? w.taskId}
                      </Link>
                      <span className="font-mono text-[11px] text-ink-faint">{w.board}</span>
                      {w.startedAt && <span className="text-xs text-ink-faint">{timeAgo(w.startedAt * 1000)}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-sm text-ink-faint">Aucune tâche du kanban en cours pour cet agent</p>
              )}
            </Panel>

            {x.soul !== null && (
              <section className="card">
                <button type="button" onClick={() => setSoulOpen((o) => !o)} aria-expanded={soulOpen}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
                  <span>
                    <span className="text-[15px] font-medium">SOUL.md</span>
                    <span className="ml-3 text-xs text-ink-faint">personnalité de l’agent, en lecture ; les valeurs qui ressemblent à des secrets sont masquées</span>
                  </span>
                  <ChevronDown className={cx('size-4 shrink-0 text-ink-faint transition-transform', soulOpen && 'rotate-180')} strokeWidth={1.5} />
                </button>
                {soulOpen && (
                  <div className="border-t border-line">
                    {x.soul ? (
                      <Suspense fallback={<p className="px-5 py-4 text-sm text-ink-faint">Chargement…</p>}>
                        <CodeView name="SOUL.md" value={x.soul} editable={false} />
                      </Suspense>
                    ) : <p className="px-5 py-4 text-sm text-ink-faint">SOUL.md vide</p>}
                    {x.soulTruncated && <p className="border-t border-line px-5 py-2 text-xs text-ink-faint">Tronqué à 64 Kio</p>}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
