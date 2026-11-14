import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Bot, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type Agent } from '../api';
import { AgentDetail } from '../agents/AgentDetail';
import { AgentModelPicker } from '../agents/AgentModel';
import { keyHint } from '../agents/keyHint';
import { Empty, ListItemBody, ListLink, ListPane, SplitView } from '../components/Panes';
import { pickSelected } from '../components/selection';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Field, Input, Tag } from '../components/ui';
import { plural, t } from '../i18n';
import { T } from '../i18n/T';

const REQUIRED: OpRef[] = [['agents', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['agents', 'create', t('Créer un agent')], ['agents', 'setDescription', t('Modifier la description')], ['agents', 'soul', t('Lire le SOUL.md')],
  ['agents', 'setSoul', t('Modifier le SOUL.md')], ['agents', 'setModel', t('Changer le modèle')], ['agents', 'remove', t('Supprimer un agent')],
  ['kanban', 'workers', t('Workers en cours')],
];
const ICON = 'size-4';
const SELECT = 'h-9 w-full rounded-lg border border-line bg-sheet px-2.5 text-sm transition-colors hover:border-ink-faint/60 focus:border-ink focus:outline-none';
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;


function NewAgent({ inst, agents, onClose, onCreated }: {
  inst: string; agents: Agent[]; onClose: () => void; onCreated: (name: string, source: 'env' | 'db', modelError: string | null) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [cloneAll, setCloneAll] = useState(false);
  const [noSkills, setNoSkills] = useState(false);
  const [soul, setSoul] = useState('');
  const [model, setModel] = useState<{ model: string; provider: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api.createAgent(inst, {
      name: name.trim(), description: description.trim() || undefined, cloneFrom: cloneFrom || undefined,
      ...(cloneFrom && cloneAll ? { cloneAll: true } : {}), ...(noSkills && !cloneFrom ? { noSkills: true } : {}),
      ...(soul.trim() ? { soul } : {}), ...(model ?? {}),
    }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['agents', inst] });
      await qc.invalidateQueries({ queryKey: ['profiles', inst] });
      onCreated(r.name, r.keySource, r.modelError);
    },
  });
  const nameOk = NAME_RE.test(name.trim());
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (nameOk) create.mutate(); }}
        className="enter flex h-full w-full flex-col bg-sheet shadow-xl md:w-[480px] md:border-l md:border-line" aria-label={t('Nouvel agent')}>
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-lg font-semibold">{t('Nouvel agent')}</h2>
          <Button type="button" variant="ghost" className="size-8 px-0" onClick={onClose} aria-label={t('Fermer')}><X className={ICON} strokeWidth={1.5} /></Button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Field label={t('Nom')} hint={t('Minuscules, chiffres, - et _ ; c’est le nom du profil Hermes')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={64} placeholder={t('recherche')} autoFocus
              aria-invalid={name !== '' && !nameOk} />
          </Field>
          <Field label={t('Description')} hint={t('Ce que fait cet agent ; le kanban s’en sert pour lui confier des tâches')}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 text-sm transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none"
              placeholder={t('Cherche et résume les sources sur un sujet.')} />
          </Field>
          <Field label={t('Partir de')} hint={t('Copie la configuration, les skills et le SOUL.md d’un agent existant')}>
            <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} className={SELECT}>
              <option value="">{t('Aucun (agent vierge)')}</option>
              {agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
            {cloneFrom && (
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={cloneAll} onChange={(e) => setCloneAll(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
                <span>{t('Copie complète')}<span className="block text-xs text-ink-faint">{t('Aussi la mémoire et les sessions de {name}. Les comptes des messageries (bots) ne sont jamais copiés.', { name: cloneFrom })}</span></span>
              </label>
            )}
          </Field>
          {!cloneFrom && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={noSkills} onChange={(e) => setNoSkills(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
              <span>{t('Sans les skills fournis')}<span className="block text-xs text-ink-faint">{t('L’agent démarre sans les skills livrés avec Hermes')}</span></span>
            </label>
          )}
          <Field label={t('Modèle')} hint={t('Celui de l’agent par défaut ; changeable ensuite')}>
            <AgentModelPicker inst={inst} profile={cloneFrom || 'default'} model={model?.model ?? null} provider={model?.provider ?? null}
              noneLabel={t('Celui d’Hermes')} title={t('Modèle du nouvel agent')} onPick={setModel} />
          </Field>
          <Field label="SOUL.md" hint={cloneFrom ? t('Laissé vide : celui de {name}', { name: cloneFrom }) : t('Personnalité de l’agent ; laissé vide : celui d’Hermes')}>
            <textarea value={soul} onChange={(e) => setSoul(e.target.value)} maxLength={65536} rows={5}
              className="w-full rounded-lg border border-line bg-sheet px-3 py-2 font-mono text-[13px] transition-colors placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-ink focus:outline-none"
              placeholder={t('Tu es un assistant de recherche. Réponds brièvement, avec tes sources.')} />
          </Field>
          <ErrorText error={create.error} />
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" onClick={onClose}>{t('Annuler')}</Button>
          <Button type="submit" variant="primary" disabled={!nameOk || create.isPending}>{create.isPending ? t('Création…') : t('Créer l’agent')}</Button>
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
  const [created, setCreated] = useState<{ name: string; source: 'env' | 'db'; modelError: string | null } | null>(null);

  const current = instances.data?.instances.find((i) => i.id === inst);
  const items = agents.data ?? [];
  const canCreate = a.available && a.has('agents', 'create');
  // the agent named in the address, else the first one (desktop); never written to the address
  const shown = name ?? pickSelected(items, undefined, (x) => x.name)?.name ?? null;

  const list = (
    <ListPane
      title={t('Agents')}
      action={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className={ICON} strokeWidth={1.5} />{t('Nouvel agent')}</Button> : undefined}
    >
      <div className="empty:hidden px-1.5 pt-1.5">
        <ModuleNotice instanceId={inst} module="agents" title={t('La liste des agents')} required={REQUIRED} optional={OPTIONAL} />
      </div>
      {created && (
        <div role="status" className="mx-1.5 mt-1.5 flex items-start gap-3 rounded-[10px] bg-ok-soft px-3.5 py-3 text-[13px]">
          <div className="min-w-0 flex-1 space-y-1">
            <p><T k="Agent {name} créé." vars={{ name: <span className="font-medium">{created.name}</span> }} /></p>
            {created.modelError && <p className="text-warn">{t('Modèle non appliqué : {error}', { error: created.modelError })}</p>}
            <p className="text-ink-soft">{keyHint(created.name, created.source)}</p>
          </div>
          <button type="button" className="text-ink-faint hover:text-ink" aria-label={t('Masquer')} onClick={() => setCreated(null)}>
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}
      <ErrorText error={agents.error} />
      {a.available && items.length === 0 && (
        <p className="px-3.5 py-6 text-sm text-ink-faint">{agents.isSuccess ? t('Aucun profil') : t('Chargement…')}</p>
      )}
      <ul className="flex flex-col gap-0.5" aria-label={t('Profils')}>
        {items.map((x) => (
          <li key={x.name} data-agent={x.name}>
            <ListLink link={{ to: '/i/$inst/agents/$name', params: { inst, name: x.name } }} selected={x.name === shown}>
              <ListItemBody
                mono
                title={x.name}
                meta={x.workers ? <span title={t('Workers du kanban en cours')}>{plural(x.workers, '{n} worker', '{n} workers', { n: x.workers })}</span> : x.isDefault ? t('par défaut') : undefined}
                sub={x.description || (x.model ? <span className="font-mono text-xs">{x.model}</span> : t('Pas de description'))}
                tag={(
                  <Tag className={cx(x.name === shown && 'bg-sheet', !x.hasKey && 'text-warn')}
                    title={x.hasKey ? undefined : t('Ajoutez sa clé API server dans profileKeys de l’instance')}>
                    {x.hasKey ? t('prêt') : t('clé manquante')}
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
      <SplitView label={t('Agents')} selected={Boolean(name)} list={list}>
        {shown && a.available ? (
          <AgentDetail key={shown} inst={inst} name={shown} instance={current} available={a.available}
            has={a.has} back={Boolean(name)} />
        ) : (
          <Empty icon={<Bot strokeWidth={1.5} />} title={a.available ? t('Aucun agent') : t('Agents indisponibles')}>
            {a.available ? t('Les profils Hermes de l’instance apparaissent ici') : t('Voir la colonne de gauche')}
          </Empty>
        )}
      </SplitView>
      {creating && (
        <NewAgent inst={inst} agents={items} onClose={() => setCreating(false)}
          onCreated={(n, source, modelError) => { setCreating(false); setCreated({ name: n, source, modelError }); }} />
      )}
    </>
  );
}
