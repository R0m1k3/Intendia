import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Agent, type PublicInstance } from '../api';
import { PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Field, Input, Mark, Panel } from '../components/ui';

const REQUIRED: OpRef[] = [['agents', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['agents', 'create', 'Créer un agent'], ['agents', 'setDescription', 'Modifier la description'], ['agents', 'soul', 'Lire le SOUL.md'],
  ['kanban', 'workers', 'Workers en cours'],
];
const ICON = 'size-4';
const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-accent focus:outline-none';
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** What to do so that Intendia can chat with a new agent: its API server key goes in profileKeys. */
export function keyHint(name: string, source: PublicInstance['source']) {
  return source === 'env'
    ? <>Pour discuter avec <code className="font-mono">{name}</code> depuis Intendia, ajoutez sa clé API server dans <code className="font-mono">profileKeys</code> de l’instance (variable <code className="font-mono">INTENDIA_INSTANCES</code>), puis redémarrez Intendia.</>
    : <>Pour discuter avec <code className="font-mono">{name}</code> depuis Intendia, ajoutez sa clé API server dans <code className="font-mono">profileKeys</code> de l’instance par <code className="font-mono">POST /x/instances</code> (voir docs/install.md).</>;
}

function NewAgent({ inst, agents, onClose, onCreated }: {
  inst: string; agents: Agent[]; onClose: () => void; onCreated: (name: string, source: 'env' | 'db') => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const create = useMutation({
    mutationFn: () => api.createAgent(inst, { name: name.trim(), description: description.trim() || undefined, cloneFrom: cloneFrom || undefined }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
      await qc.invalidateQueries({ queryKey: ['profiles', inst] });
      onCreated(r.name, r.keySource);
    },
  });
  const nameOk = NAME_RE.test(name.trim());
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (nameOk) create.mutate(); }}
        className="enter flex h-full w-full flex-col bg-paper shadow-xl md:w-[480px] md:border-l md:border-line" aria-label="Nouvel agent">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[15px] font-medium">Nouvel agent</h2>
          <Button type="button" variant="ghost" className="size-8 px-0" onClick={onClose} aria-label="Fermer"><X className={ICON} strokeWidth={1.5} /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Field label="Nom" hint="Minuscules, chiffres, - et _ ; c’est le nom du profil Hermes">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder="recherche" autoFocus
              aria-invalid={name !== '' && !nameOk} />
          </Field>
          <Field label="Description" hint="Ce que fait cet agent ; le kanban s’en sert pour lui confier des tâches">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-accent focus:outline-none"
              placeholder="Cherche et résume les sources sur un sujet." />
          </Field>
          <Field label="Partir de" hint="Copie la configuration, les skills et le SOUL.md d’un agent existant">
            <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} className={SELECT}>
              <option value="">Aucun (agent vierge)</option>
              {agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </Field>
          <ErrorText error={create.error} />
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={!nameOk || create.isPending}>{create.isPending ? 'Création…' : 'Créer l’agent'}</Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

export function AgentsPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'agents', REQUIRED, OPTIONAL);
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst).then((r) => r.agents), enabled: a.available });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; source: 'env' | 'db' } | null>(null);

  const list = instances.data?.instances ?? [];
  const current = list.find((i) => i.id === inst);
  const items = agents.data ?? [];
  const showWorkers = items.some((x) => x.workers !== null);
  const canCreate = a.available && a.has('agents', 'create');

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle={<>Les profils Hermes de {current ? <span className="text-ink">{current.label}</span> : 'l’instance'} : chacun a son modèle, ses skills et sa mémoire.</>}
        action={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className={ICON} strokeWidth={1.5} />Nouvel agent</Button> : undefined}
      />
      <div className="space-y-6 px-5 pb-10 md:px-8">
        {list.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Instance">
            {list.map((i) => (
              <Link key={i.id} to="/i/$inst/agents" params={{ inst: i.id }}
                className={cx('h-8 rounded-lg border px-3 text-[13px] leading-8 transition-colors', i.id === inst ? 'border-accent text-ink' : 'border-line text-ink-soft hover:text-ink')}>
                {i.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="empty:hidden">
          <ModuleNotice instanceId={inst} module="agents" title="La liste des agents" required={REQUIRED} optional={OPTIONAL} />
        </div>
        {created && (
          <div role="status" className="flex items-start gap-3 rounded-xl border border-line bg-sheet px-5 py-4 text-sm">
            <Mark state="full" className="mt-1" />
            <div className="min-w-0 flex-1 space-y-1">
              <p>Agent <span className="font-medium">{created.name}</span> créé.</p>
              <p className="text-ink-soft">{keyHint(created.name, created.source)}</p>
            </div>
            <button type="button" className="text-ink-faint hover:text-ink" aria-label="Masquer" onClick={() => setCreated(null)}>
              <X className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
        <ErrorText error={agents.error} />
        {a.available && (
          <Panel bodyClassName="p-0" title="Profils" action={<span className="font-mono text-[11px] text-ink-faint">{items.length}</span>}>
            {items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-faint">
                      <th className="px-5 py-2.5 font-normal">Agent</th>
                      <th className="px-3 py-2.5 font-normal">Modèle</th>
                      <th className="px-3 py-2.5 text-right font-normal">Skills</th>
                      <th className="px-3 py-2.5 font-normal">Chat</th>
                      {showWorkers && <th className="px-5 py-2.5 text-right font-normal">Workers</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((x) => (
                      <tr key={x.name} className="transition-colors hover:bg-raised/60">
                        <td className="max-w-[340px] px-5 py-3">
                          <Link to="/i/$inst/agents/$name" params={{ inst, name: x.name }} className="font-medium hover:text-accent">{x.name}</Link>
                          {x.isDefault && <span className="ml-2 text-xs text-ink-faint">par défaut</span>}
                          {x.description && <p className="mt-0.5 truncate text-xs text-ink-soft" title={x.description}>{x.description}</p>}
                        </td>
                        <td className="px-3 py-3 font-mono text-[12px] text-ink-soft">{x.model ?? '—'}</td>
                        <td className="px-3 py-3 text-right font-mono text-[12px] text-ink-soft">{x.skillCount ?? '—'}</td>
                        <td className="px-3 py-3">
                          <span className={cx('inline-flex items-center gap-2 text-xs', x.hasKey ? 'text-ink-faint' : 'text-warn')}
                            title={x.hasKey ? undefined : 'Ajoutez sa clé API server dans profileKeys de l’instance'}>
                            <Mark state={x.hasKey ? 'full' : 'unavailable'} />{x.hasKey ? 'prêt' : 'clé manquante'}
                          </span>
                        </td>
                        {showWorkers && (
                          <td className={cx('px-5 py-3 text-right font-mono text-[12px]', x.workers ? 'text-ink' : 'text-ink-faint')}>{x.workers ?? '—'}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-ink-faint">{agents.isSuccess ? 'Aucun profil' : 'Chargement…'}</p>
            )}
          </Panel>
        )}
      </div>
      {creating && (
        <NewAgent inst={inst} agents={items} onClose={() => setCreating(false)}
          onCreated={(name, source) => { setCreating(false); setCreated({ name, source }); }} />
      )}
    </div>
  );
}
