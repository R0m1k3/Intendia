
import { useQuery, } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Bot, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { api, } from '../api';
import { AgentDetail } from '../agents/AgentDetail';
import { NewAgent } from '../agents/NewAgent';
import { keyHint } from '../agents/keyHint';
import { Empty, ListItemBody, ListLink, ListPane, SplitView } from '../components/Panes';
import { pickSelected } from '../components/selection';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Tag, SkeletonList } from '../components/ui';
import { plural, t } from '../i18n';
import { T } from '../i18n/T';

const REQUIRED: OpRef[] = [['agents', 'list']];
const OPTIONAL: OptionalOp[] = [
  ['agents', 'create', t('Créer un agent')], ['agents', 'setDescription', t('Modifier la description')], ['agents', 'soul', t('Lire le SOUL.md')],
  ['agents', 'setSoul', t('Modifier le SOUL.md')], ['agents', 'setModel', t('Changer le modèle')], ['agents', 'remove', t('Supprimer un agent')],
  ['kanban', 'workers', t('Workers en cours')],
];
const ICON = 'size-4';


export function AgentsPage() {
  const { inst, name } = useParams({ strict: false }) as { inst: string; name?: string };
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'agents', REQUIRED, OPTIONAL);
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst).then((r) => r.agents), enabled: a.available });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; source: 'env' | 'db'; modelError: string | null; connectError: string | null } | null>(null);

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
            {created.connectError && <p className="text-warn">{t('Pas encore connecté à Intendia : {error}', { error: created.connectError })}</p>}
            {created.connectError && <p className="text-ink-soft">{keyHint(created.name, created.source)}</p>}
          </div>
          <button type="button" className="text-ink-faint hover:text-ink" aria-label={t('Masquer')} onClick={() => setCreated(null)}>
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        </div>
      )}
      <ErrorText error={agents.error} onRetry={() => void agents.refetch()} />
      {a.available && items.length === 0 && (agents.isSuccess
        ? <p className="px-3.5 py-6 text-sm text-ink-faint">{t('Aucun agent')}</p>
        : agents.isPending && <SkeletonList rows={6} />)}
      <ul className="flex flex-col gap-0.5" aria-label={t('Agents')}>
        {items.map((x) => (
          <li key={x.name} data-agent={x.name}>
            <ListLink link={{ to: '/i/$inst/agents/$name', params: { inst, name: x.name } }} selected={x.name === shown}>
              <ListItemBody
                mono
                title={x.name}
                meta={x.workers ? <span title={t('Tâches que cet agent exécute en ce moment')}>{plural(x.workers, '{n} worker', '{n} workers', { n: x.workers })}</span> : x.isDefault ? t('par défaut') : undefined}
                sub={x.description || (x.model ? <span className="font-mono text-xs">{x.model}</span> : t('Pas de description'))}
                tag={(
                  <Tag className={cx(x.name === shown && 'bg-sheet', !x.hasKey && 'text-warn')}
                    title={x.hasKey ? undefined : t('Ouvrez sa fiche puis « Connecter à Intendia »')}>
                    {x.hasKey ? t('prêt') : t('non connecté')}
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
          <Empty icon={<Bot strokeWidth={1.5} />} title={a.available ? t('Aucun agent') : a.onlyPending ? t('Vérification de cette instance en cours') : t('Agents indisponibles')}>
            {a.available ? t('Les agents de l’instance apparaissent ici') : t('Voir la colonne de gauche')}
          </Empty>
        )}
      </SplitView>
      {creating && (
        <NewAgent inst={inst} agents={items} onClose={() => setCreating(false)}
          onCreated={(n, source, modelError, connectError) => { setCreating(false); setCreated({ name: n, source, modelError, connectError }); }} />
      )}
    </>
  );
}
