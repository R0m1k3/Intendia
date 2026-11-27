import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { Narrow, PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, chipClass, cx, Input } from '../components/ui';
import { ICON, configKey } from '../config/common';
import { Hint } from '../components/Hint';
import { ProfileSelect } from '../components/ProfileSelect';
import { ConfigEnv } from '../config/Env';
import { GUARDRAILS } from '../config/guardrails';
import { ConfigForm } from '../config/Form';
import { ConfigHistory } from '../config/History';
import { ConfigMcp } from '../config/Mcp';
import { ConfigModelsTab } from '../config/Models';
import { ConfigProviders } from '../config/Providers';
import { ConfigPlatforms } from '../config/Platforms';
import { ConfigPlugins } from '../config/Plugins';
import { ConfigYaml } from '../config/Yaml';
import { RESTART_CONFIRM, RestartStrip, useRestart } from '../config/restart';
import { ask } from '../components/Dialog';
import { t } from '../i18n';
import { T } from '../i18n/T';
import { term, type TermId } from '../help/glossary';
import { CONFIG_TABS, type ConfigTab } from '../routes/search';

const REQUIRED: OpRef[] = [['config', 'get']];
const OPTIONAL: OptionalOp[] = [
  ['config', 'schema', t('Formulaire')], ['config', 'put', t('Enregistrer le formulaire')], ['config', 'raw', t('Éditeur YAML et historique')],
  ['config', 'putRaw', t('Enregistrer le YAML, restaurer')], ['config', 'modelInfo', t('Modèles')], ['config', 'setModel', t('Changer de modèle')],
  ['config', 'env', t('Variables')], ['config', 'putEnv', t('Définir une variable')], ['config', 'mcpServers', t('Serveurs MCP')],
  ['config', 'platforms', t('Messageries')], ['config', 'restartGateway', t('Redémarrer la passerelle')],
  ['config', 'oauthList', t('Abonnements')], ['config', 'oauthStart', t('Connecter un abonnement')], ['config', 'oauthPoll', t('Suivre une connexion')],
  ['config', 'oauthCancel', t('Annuler une connexion')], ['config', 'oauthDisconnect', t('Déconnecter un abonnement')],
  ['config', 'mcpCatalog', t('Catalogue MCP')], ['config', 'mcpAuth', t('Connexion OAuth MCP')],
  ['config', 'poolList', t('Clés d’API')], ['config', 'poolAdd', t('Ajouter une clé')], ['config', 'poolRemove', t('Retirer une clé')],
];

const PLUGINS_REQUIRED: OpRef[] = [['plugins', 'installed']];
const PLUGINS_OPTIONAL: OptionalOp[] = [
  ['plugins', 'catalog', t('Catalogue')], ['plugins', 'install', t('Installer')], ['plugins', 'enable', t('Activer')], ['plugins', 'disable', t('Désactiver')],
  ['plugins', 'remove', t('Désinstaller')],
];

export { CONFIG_TABS, type ConfigTab };
export interface ConfigSearch { profile?: string; tab?: ConfigTab; key?: string }

/** A tab shows when the config module has its operation (one of them, for a list); Plugins is its own module. */
const TAB: Record<Exclude<ConfigTab, 'plugins'>, { label: string; op: string | string[] }> = {
  modeles: { label: t('Modèles'), op: 'modelInfo' },
  fournisseurs: { label: t('Fournisseurs'), op: ['oauthList', 'poolList'] },
  reglages: { label: t('Réglages'), op: 'schema' },
  'garde-fous': { label: t('Garde-fous'), op: 'schema' },
  yaml: { label: t('YAML'), op: 'raw' },
  variables: { label: t('Variables'), op: 'env' },
  mcp: { label: t('MCP'), op: 'mcpServers' },
  plateformes: { label: t('Messageries'), op: 'platforms' },
  historique: { label: t('Historique'), op: 'raw' },
};

/** The tabs in three groups (in this order); a group without any available tab is not shown. */
const GROUPS: readonly { key: string; label: string; tabs: readonly ConfigTab[] }[] = [
  { key: 'ia', label: t('Modèles et fournisseurs'), tabs: ['modeles', 'fournisseurs'] },
  { key: 'comportement', label: t('Comportement'), tabs: ['reglages', 'garde-fous', 'mcp', 'plugins', 'plateformes'] },
  { key: 'avance', label: t('Avancé'), tabs: ['yaml', 'variables', 'historique'] },
];

/** The sentence under the tabs: what this section is, in plain words (help/glossary.ts). */
const TAB_TERM: Partial<Record<ConfigTab, TermId>> = {
  modeles: 'fournisseur', fournisseurs: 'fournisseur', 'garde-fous': 'garde-fous', yaml: 'yaml', variables: 'variables', mcp: 'mcp', plateformes: 'passerelle',
};

export function ConfigPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as ConfigSearch;
  const profile = search.profile ?? 'default';
  return <ConfigView key={`${inst}:${profile}`} inst={inst} profile={profile} search={search} />;
}

function ConfigView({ inst, profile, search }: { inst: string; profile: string; search: ConfigSearch }) {
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const a = useModuleAvailability(inst, 'config', REQUIRED, OPTIONAL);
  const can = (op: string) => a.has('config', op);
  const pa = useModuleAvailability(inst, 'plugins', PLUGINS_REQUIRED, PLUGINS_OPTIONAL);
  const tabs = CONFIG_TABS.filter((k) => (k === 'plugins' ? pa.available : [TAB[k].op].flat().some(can)));
  const tab: ConfigTab | undefined = search.tab && tabs.includes(search.tab) ? search.tab : tabs[0];
  const [needRestart, setNeedRestart] = useState(false);
  // « Chercher un réglage » from another tab: Enter opens Réglages with the text already searched
  const [find, setFind] = useState('');
  const restart = useRestart(inst, profile, () => setNeedRestart(false));
  const platforms = useQuery({
    queryKey: configKey(inst, profile, 'platforms'), queryFn: () => api.platforms(inst, profile).then((r) => r.platforms),
    enabled: a.available && can('platforms'),
  });
  const pendingPlatform = (platforms.data ?? []).some((p) => p.state === 'pending_restart');

  const list = instances.data?.instances ?? [];
  const current = list.find((i) => i.id === inst);
  const go = (next: Partial<ConfigSearch>) => void navigate({
    to: '/i/$inst/config', params: { inst },
    search: { profile: profile === 'default' ? undefined : profile, tab, ...next },
  });
  const props = { inst, profile, can, onSaved: (r: boolean) => { if (r) setNeedRestart(true); } };

  return (
    <Narrow>
      <PageHeader
        title={t('Configuration')}
        subtitle={<T k="Agent {profile} sur {instance}" vars={{ profile: <span className="font-mono text-ink-soft">{profile}</span>, instance: current ? current.label : t('l’instance') }} />}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <ProfileSelect inst={inst} value={profile}
              onChange={(p) => void navigate({ to: '/i/$inst/config', params: { inst }, search: { profile: p === 'default' ? undefined : p, tab } })} />
            {a.available && can('restartGateway') && (
              <Button disabled={restart.running} onClick={async () => { if (await ask(RESTART_CONFIRM)) restart.start(); }}>
                <RefreshCw className={cx(ICON, restart.running && 'animate-spin')} strokeWidth={1.5} />{restart.running ? t('Redémarrage…') : t('Redémarrer la passerelle')}
              </Button>
            )}
            {a.available && can('restartGateway') && <Hint id="passerelle" />}
          </div>
        )}
      />
      <div className="space-y-5 px-4 pb-14 md:px-8">
        <div className="empty:hidden">
          <ModuleNotice instanceId={inst} module="config" title={t('La configuration')} required={REQUIRED} optional={OPTIONAL} explainMissing />
        </div>
        {(needRestart || pendingPlatform) && !restart.running && !restart.done && can('restartGateway') && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn">
            <span>{pendingPlatform && !needRestart ? t('Une plateforme attend un redémarrage de la passerelle.') : t('Certains changements ne comptent qu’après un redémarrage de la passerelle.')}</span>
            <Button onClick={async () => { if (await ask(RESTART_CONFIRM)) restart.start(); }}><RefreshCw className={ICON} strokeWidth={1.5} />{t('Redémarrer')}</Button>
          </div>
        )}
        <RestartStrip state={restart} />
        {a.available && tab && (
          <>
<div className="flex flex-wrap items-end gap-x-6 gap-y-3" data-config-tabs>
              {GROUPS.map((g) => {
                const own = g.tabs.filter((k) => tabs.includes(k));
                if (!own.length) return null;
                return (
                  <div key={g.key} data-config-group={g.key}>
                    <p className="mb-1.5 text-xs font-medium text-ink-faint" aria-hidden>{g.label}</p>
                    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={g.label}>
                      {own.map((k) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go({ tab: k, key: undefined })} className={chipClass(tab === k)}>
                          {k === 'plugins' ? t('Plugins') : TAB[k].label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {tab !== 'reglages' && tabs.includes('reglages') && (
                <form className="relative ml-auto w-full sm:w-56" onSubmit={(e) => { e.preventDefault(); if (find.trim()) go({ tab: 'reglages', key: undefined }); }}>
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
                  <Input className="pl-8" placeholder={t('Chercher un réglage')} aria-label={t('Chercher un réglage')} value={find} onChange={(e) => setFind(e.target.value)} />
                </form>
              )}
            </div>
            {TAB_TERM[tab] && <p className="-mt-1 max-w-3xl text-sm text-ink-faint" data-tab-help>{term(TAB_TERM[tab]).text}</p>}
            {tab === 'modeles' && <ConfigModelsTab {...props} onKey={(key) => go({ tab: 'variables', key })} onProviders={() => go({ tab: 'fournisseurs', key: undefined })} />}
            {tab === 'fournisseurs' && <ConfigProviders {...props} onVariable={(key) => go({ tab: 'variables', key })} />}
            {tab === 'reglages' && <ConfigForm key={find} {...props} initialQuery={find} />}
            {tab === 'garde-fous' && <ConfigForm {...props} preset={GUARDRAILS} />}
            {tab === 'yaml' && <ConfigYaml {...props} />}
            {tab === 'variables' && <ConfigEnv key={search.key ?? ''} {...props} focusKey={search.key} />}
            {tab === 'mcp' && <ConfigMcp {...props} />}
            {tab === 'plugins' && (
              <ConfigPlugins inst={inst} can={(op) => pa.has('plugins', op)} onVariable={(key) => go({ tab: 'variables', key })} onRestart={() => setNeedRestart(true)} />
            )}
            {tab === 'plateformes' && <ConfigPlatforms {...props} />}
            {tab === 'historique' && <ConfigHistory {...props} />}
          </>
        )}
      </div>
    </Narrow>
  );
}
