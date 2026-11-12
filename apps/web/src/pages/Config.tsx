import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { Narrow, PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, Chips, cx } from '../components/ui';
import { ICON, configKey } from '../config/common';
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

const REQUIRED: OpRef[] = [['config', 'get']];
const OPTIONAL: OptionalOp[] = [
  ['config', 'schema', 'Formulaire'], ['config', 'put', 'Enregistrer le formulaire'], ['config', 'raw', 'Éditeur YAML et historique'],
  ['config', 'putRaw', 'Enregistrer le YAML, restaurer'], ['config', 'modelInfo', 'Modèles'], ['config', 'setModel', 'Changer de modèle'],
  ['config', 'env', 'Variables'], ['config', 'putEnv', 'Définir une variable'], ['config', 'mcpServers', 'Serveurs MCP'],
  ['config', 'platforms', 'Plateformes'], ['config', 'restartGateway', 'Redémarrer la passerelle'],
  ['config', 'oauthList', 'Abonnements'], ['config', 'oauthStart', 'Connecter un abonnement'], ['config', 'oauthPoll', 'Suivre une connexion'],
  ['config', 'oauthCancel', 'Annuler une connexion'], ['config', 'oauthDisconnect', 'Déconnecter un abonnement'],
  ['config', 'mcpCatalog', 'Catalogue MCP'], ['config', 'mcpAuth', 'Connexion OAuth MCP'],
  ['config', 'poolList', 'Clés d’API'], ['config', 'poolAdd', 'Ajouter une clé'], ['config', 'poolRemove', 'Retirer une clé'],
];

const PLUGINS_REQUIRED: OpRef[] = [['plugins', 'installed']];
const PLUGINS_OPTIONAL: OptionalOp[] = [
  ['plugins', 'catalog', 'Catalogue'], ['plugins', 'install', 'Installer'], ['plugins', 'enable', 'Activer'], ['plugins', 'disable', 'Désactiver'],
  ['plugins', 'remove', 'Désinstaller'],
];

export const CONFIG_TABS = ['modeles', 'fournisseurs', 'reglages', 'garde-fous', 'yaml', 'variables', 'mcp', 'plugins', 'plateformes', 'historique'] as const;
export type ConfigTab = (typeof CONFIG_TABS)[number];
export interface ConfigSearch { profile?: string; tab?: ConfigTab; key?: string }

/** A tab shows when the config module has its operation (one of them, for a list); Plugins is its own module. */
const TAB: Record<Exclude<ConfigTab, 'plugins'>, { label: string; op: string | string[] }> = {
  modeles: { label: 'Modèles', op: 'modelInfo' },
  fournisseurs: { label: 'Fournisseurs', op: ['oauthList', 'poolList'] },
  reglages: { label: 'Réglages', op: 'schema' },
  'garde-fous': { label: 'Garde-fous', op: 'schema' },
  yaml: { label: 'YAML', op: 'raw' },
  variables: { label: 'Variables', op: 'env' },
  mcp: { label: 'MCP', op: 'mcpServers' },
  plateformes: { label: 'Plateformes', op: 'platforms' },
  historique: { label: 'Historique', op: 'raw' },
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
  const tabs = CONFIG_TABS.filter((t) => (t === 'plugins' ? pa.available : [TAB[t].op].flat().some(can)));
  const tab: ConfigTab | undefined = search.tab && tabs.includes(search.tab) ? search.tab : tabs[0];
  const [needRestart, setNeedRestart] = useState(false);
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
        title="Configuration"
        subtitle={<>Agent <span className="font-mono text-ink-soft">{profile}</span> sur {current ? current.label : 'l’instance'}</>}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <ProfileSelect inst={inst} value={profile}
              onChange={(p) => void navigate({ to: '/i/$inst/config', params: { inst }, search: { profile: p === 'default' ? undefined : p, tab } })} />
            {a.available && can('restartGateway') && (
              <Button disabled={restart.running} onClick={async () => { if (await ask(RESTART_CONFIRM)) restart.start(); }}>
                <RefreshCw className={cx(ICON, restart.running && 'animate-spin')} strokeWidth={1.5} />{restart.running ? 'Redémarrage…' : 'Redémarrer la passerelle'}
              </Button>
            )}
          </div>
        )}
      />
      <div className="space-y-5 px-4 pb-14 md:px-8">
        <div className="empty:hidden">
          <ModuleNotice instanceId={inst} module="config" title="La configuration" required={REQUIRED} optional={OPTIONAL} explainMissing />
        </div>
        {(needRestart || pendingPlatform) && !restart.running && !restart.done && can('restartGateway') && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn">
            <span>{pendingPlatform && !needRestart ? 'Une plateforme attend un redémarrage de la passerelle.' : 'Certains changements ne comptent qu’après un redémarrage de la passerelle.'}</span>
            <Button onClick={async () => { if (await ask(RESTART_CONFIRM)) restart.start(); }}><RefreshCw className={ICON} strokeWidth={1.5} />Redémarrer</Button>
          </div>
        )}
        <RestartStrip state={restart} />
        {a.available && tab && (
          <>
            <Chips role="tab" label="Sections" value={tab} items={tabs.map((t) => ({ key: t, label: t === 'plugins' ? 'Plugins' : TAB[t].label }))} onChange={(t) => go({ tab: t, key: undefined })} />
            {tab === 'modeles' && <ConfigModelsTab {...props} onKey={(key) => go({ tab: 'variables', key })} onProviders={() => go({ tab: 'fournisseurs', key: undefined })} />}
            {tab === 'fournisseurs' && <ConfigProviders {...props} onVariable={(key) => go({ tab: 'variables', key })} />}
            {tab === 'reglages' && <ConfigForm {...props} />}
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
