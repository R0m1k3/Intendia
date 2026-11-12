import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Bot, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Agent } from '../api';
import { AgentDetail } from '../agents/AgentDetail';
import { keyHint } from '../agents/keyHint';
import { Empty, ListItemBody, ListLink, ListPane, SplitView } from '../components/Panes';
import { pickSelected } from '../components/selection';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Field, Input, Tag } from '../components/ui';

const REQUIRED: OpRef[] = [['agents', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['agents', 'create', 'Créer un agent'], ['agents', 'setDescription', 'Modifier la description'], ['agents', 'soul', 'Lire le SOUL.md'],
  ['kanban', 'workers', 'Workers en cours'],
];
const ICON = 'size-4';
const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;


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
        className="enter flex h-full w-full flex-col bg-sheet shadow-xl md:w-[480px] md:border-l md:border-line" aria-label="Nouvel agent">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-lg font-semibold">Nouvel agent</h2>
          <Button type="button" variant="ghost" className="size-8 px-0" onClick={onClose} aria-label="Fermer"><X className={ICON} strokeWidth={1.5} /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Field label="Nom" hint="Minuscules, chiffres, - et _ ; c’est le nom du profil Hermes">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder="recherche" autoFocus
              aria-invalid={name !== '' && !nameOk} />
          </Field>
          <Field label="Description" hint="Ce que fait cet agent ; le kanban s’en sert pour lui confier des tâches">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none"
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
  const { inst, name } = useParams({ strict: false }) as { inst: string; name?: string };
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'agents', REQUIRED, OPTIONAL);
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst).then((r) => r.agents), enabled: a.available });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; source: 'env' | 'db' } | null>(null);

  const current = instances.data?.instances.find((i) => i.id === inst);
  const items = agents.data ?? [];
  const canCreate = a.available && a.has('agents', 'create');
  // the agent named in the address, else the first one (desktop); never written to the address
  const shown = name ?? pickSelected(items, undefined, (x) => x.name)?.name ?? null;

  const list = (
    <ListPane
      title="Agents"
      action={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className={ICON} strokeWidth={1.5} />Nouvel agent</Button> : undefined}
    >
      <div className="empty:hidden px-1.5 pt-1.5">
        <ModuleNotice instanceId={inst} module="agents" title="La liste des agents" required={REQUIRED} optional={OPTIONAL} />
      </div>
      {created && (
        <div role="status" className="mx-1.5 mt-1.5 flex items-start gap-3 rounded-[10px] bg-ok-soft px-3.5 py-3 text-[13px]">
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
      {a.available && items.length === 0 && (
        <p className="px-3.5 py-6 text-sm text-ink-faint">{agents.isSuccess ? 'Aucun profil' : 'Chargement…'}</p>
      )}
      <ul className="flex flex-col gap-0.5" aria-label="Profils">
        {items.map((x) => (
          <li key={x.name} data-agent={x.name}>
            <ListLink link={{ to: '/i/$inst/agents/$name', params: { inst, name: x.name } }} selected={x.name === shown}>
              <ListItemBody
                mono
                title={x.name}
                meta={x.workers ? <span title="Workers du kanban en cours">{x.workers} worker{x.workers > 1 ? 's' : ''}</span> : x.isDefault ? 'par défaut' : undefined}
                sub={x.description || (x.model ? <span className="font-mono text-xs">{x.model}</span> : 'Pas de description')}
                tag={(
                  <Tag className={cx(x.name === shown && 'bg-sheet', !x.hasKey && 'text-warn')}
                    title={x.hasKey ? undefined : 'Ajoutez sa clé API server dans profileKeys de l’instance'}>
                    {x.hasKey ? 'prêt' : 'clé manquante'}
                  </Tag>
                )}
              />
            </ListLink>
          </li>
        ))}
      </ul>
    </ListPane>
  );

  return (
    <>
      <SplitView label="Agents" selected={Boolean(name)} list={list}>
        {shown && a.available ? (
          <AgentDetail key={shown} inst={inst} name={shown} instance={current} available={a.available}
            canEdit={a.has('agents', 'setDescription')} back={Boolean(name)} />
        ) : (
          <Empty icon={<Bot strokeWidth={1.5} />} title={a.available ? 'Aucun agent' : 'Agents indisponibles'}>
            {a.available ? 'Les profils Hermes de l’instance apparaissent ici' : 'Voir la colonne de gauche'}
          </Empty>
        )}
      </SplitView>
      {creating && (
        <NewAgent inst={inst} agents={items} onClose={() => setCreating(false)}
          onCreated={(n, source) => { setCreating(false); setCreated({ name: n, source }); }} />
      )}
    </>
  );
}
