import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, type RestartStatus } from '../api';
import { PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef, type OptionalOp } from '../components/ModuleNotice';
import { Button, cx, ErrorText } from '../components/ui';
import { ICON, SELECT, configKey } from '../config/common';
import { ConfigEnv } from '../config/Env';
import { ConfigForm } from '../config/Form';
import { ConfigHistory } from '../config/History';
import { ConfigMcp } from '../config/Mcp';
import { ConfigModelsTab } from '../config/Models';
import { ConfigPlatforms } from '../config/Platforms';
import { ConfigYaml } from '../config/Yaml';

const REQUIRED: OpRef[] = [['config', 'get']];
const OPTIONAL: OptionalOp[] = [
  ['config', 'schema', 'Formulaire'], ['config', 'put', 'Enregistrer le formulaire'], ['config', 'raw', 'Éditeur YAML et historique'],
  ['config', 'putRaw', 'Enregistrer le YAML, restaurer'], ['config', 'modelInfo', 'Modèles'], ['config', 'setModel', 'Changer de modèle'],
  ['config', 'env', 'Variables'], ['config', 'putEnv', 'Définir une variable'], ['config', 'mcpServers', 'Serveurs MCP'],
  ['config', 'platforms', 'Plateformes'], ['config', 'restartGateway', 'Redémarrer la passerelle'],
];

export const CONFIG_TABS = ['modeles', 'reglages', 'yaml', 'variables', 'mcp', 'plateformes', 'historique'] as const;
export type ConfigTab = (typeof CONFIG_TABS)[number];
export interface ConfigSearch { profile?: string; tab?: ConfigTab; key?: string }

const TAB: Record<ConfigTab, { label: string; op: string }> = {
  modeles: { label: 'Modèles', op: 'modelInfo' },
  reglages: { label: 'Réglages', op: 'schema' },
  yaml: { label: 'YAML', op: 'raw' },
  variables: { label: 'Variables', op: 'env' },
  mcp: { label: 'MCP', op: 'mcpServers' },
  plateformes: { label: 'Plateformes', op: 'platforms' },
  historique: { label: 'Historique', op: 'raw' },
};

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60_000;
const RESTART_CONFIRM = 'Redémarrer la passerelle ? Les runs en cours seront interrompus. Si la passerelle sert plusieurs agents, tous sont concernés.';

export function ConfigPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as ConfigSearch;
  const profile = search.profile ?? 'default';
  return <ConfigView key={`${inst}:${profile}`} inst={inst} profile={profile} search={search} />;
}

function ConfigView({ inst, profile, search }: { inst: string; profile: string; search: ConfigSearch }) {
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const profiles = useQuery({ queryKey: ['profiles', inst], queryFn: () => api.profiles(inst).then((r) => r.profiles) });
  const a = useModuleAvailability(inst, 'config', REQUIRED, OPTIONAL);
  const can = (op: string) => a.has('config', op);
  const tabs = CONFIG_TABS.filter((t) => can(TAB[t].op));
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
  const names = profiles.data ?? ['default'];
  const options = names.includes(profile) ? names : [...names, profile];
  const go = (next: Partial<ConfigSearch>) => void navigate({
    to: '/i/$inst/config', params: { inst },
    search: { profile: profile === 'default' ? undefined : profile, tab, ...next },
  });
  const props = { inst, profile, can, onSaved: (r: boolean) => { if (r) setNeedRestart(true); } };

  return (
    <div>
      <PageHeader
        title="Configuration"
        subtitle={<>Les réglages d’Hermes pour l’agent <span className="font-mono text-ink">{profile}</span> sur {current ? <span className="text-ink">{current.label}</span> : 'l’instance'}.</>}
        action={(
          <div className="flex flex-wrap gap-2">
            {options.length > 1 && (
              <select className={SELECT} value={profile} aria-label="Agent"
                onChange={(e) => void navigate({ to: '/i/$inst/config', params: { inst }, search: { profile: e.target.value === 'default' ? undefined : e.target.value, tab } })}>
                {options.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {a.available && can('restartGateway') && (
              <Button disabled={restart.running} onClick={() => { if (confirm(RESTART_CONFIRM)) restart.start(); }}>
                <RefreshCw className={cx(ICON, restart.running && 'animate-spin')} strokeWidth={1.5} />{restart.running ? 'Redémarrage…' : 'Redémarrer la passerelle'}
              </Button>
            )}
          </div>
        )}
      />
      <div className="space-y-6 px-5 pb-10 md:px-8">
        {list.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Instance">
            {list.map((i) => (
              <Link key={i.id} to="/i/$inst/config" params={{ inst: i.id }}
                className={cx('h-8 rounded-lg border px-3 text-[13px] leading-8 transition-colors', i.id === inst ? 'border-accent text-ink' : 'border-line text-ink-soft hover:text-ink')}>
                {i.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="empty:hidden">
          <ModuleNotice instanceId={inst} module="config" title="La configuration" required={REQUIRED} optional={OPTIONAL} explainMissing />
        </div>
        {(needRestart || pendingPlatform) && !restart.running && !restart.done && can('restartGateway') && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 p-4 text-sm">
            <span>{pendingPlatform && !needRestart ? 'Une plateforme attend un redémarrage de la passerelle.' : 'Certains changements ne comptent qu’après un redémarrage de la passerelle.'}</span>
            <Button onClick={() => { if (confirm(RESTART_CONFIRM)) restart.start(); }}><RefreshCw className={ICON} strokeWidth={1.5} />Redémarrer</Button>
          </div>
        )}
        <RestartStrip state={restart} />
        {a.available && tab && (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
              {tabs.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => go({ tab: t, key: undefined })}
                  className={cx('-mb-px h-9 shrink-0 border-b-2 px-3 text-sm transition-colors', tab === t ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink')}>
                  {TAB[t].label}
                </button>
              ))}
            </div>
            {tab === 'modeles' && <ConfigModelsTab {...props} onKey={(key) => go({ tab: 'variables', key })} />}
            {tab === 'reglages' && <ConfigForm {...props} />}
            {tab === 'yaml' && <ConfigYaml {...props} />}
            {tab === 'variables' && <ConfigEnv key={search.key ?? ''} {...props} focusKey={search.key} />}
            {tab === 'mcp' && <ConfigMcp {...props} />}
            {tab === 'plateformes' && <ConfigPlatforms {...props} />}
            {tab === 'historique' && <ConfigHistory {...props} />}
          </>
        )}
      </div>
    </div>
  );
}

interface RestartState { running: boolean; done: boolean; status: RestartStatus | null; error: unknown; timedOut: boolean; start: () => void; dismiss: () => void }

/** Starts the restart, then polls its action status until it ends (or 5 min). */
function useRestart(inst: string, profile: string, onDone: () => void): RestartState {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<RestartStatus | null>(null);
  const [done, setDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [pollError, setPollError] = useState<unknown>(null);
  const begin = useMutation({
    mutationFn: () => api.restartGateway(inst, profile),
    onSuccess: () => { setStatus(null); setDone(false); setTimedOut(false); setPollError(null); setStartedAt(Date.now()); },
  });
  useEffect(() => {
    if (startedAt === null) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api.restartStatus(inst, profile).then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (!s.running && s.exitCode !== null) { setStartedAt(null); setDone(true); onDone(); }
      }).catch((e: unknown) => {
        if (cancelled) return;
        // the gateway may answer nothing while it restarts: keep polling
        if (!(e instanceof ApiError) || e.status >= 500) return;
        setPollError(e); setStartedAt(null);
      });
      if (Date.now() - startedAt > POLL_MAX_MS) { setTimedOut(true); setStartedAt(null); }
    }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [startedAt, inst, profile]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    running: begin.isPending || startedAt !== null, done, status, error: begin.error ?? pollError, timedOut,
    start: () => begin.mutate(), dismiss: () => { setDone(false); setTimedOut(false); setStatus(null); begin.reset(); setPollError(null); },
  };
}

function RestartStrip({ state }: { state: RestartState }) {
  const { running, done, status, error, timedOut } = state;
  if (!running && !done && !error && !timedOut) return null;
  const failed = done && status?.exitCode !== 0;
  return (
    <div className={cx('space-y-2 rounded-xl border p-4 text-sm', failed || error ? 'border-bad/40' : 'border-line')}>
      <div className="flex items-center justify-between gap-3">
        <span>
          {running ? 'Redémarrage de la passerelle…'
            : timedOut ? 'Le redémarrage ne s’est pas terminé en 5 minutes : voir l’état de l’instance.'
            : error ? 'Le redémarrage n’a pas pu être lancé ou suivi.'
            : failed ? `Le redémarrage a échoué (code ${status?.exitCode}).` : 'Passerelle redémarrée.'}
        </span>
        {!running && <Button variant="ghost" className="h-7" onClick={state.dismiss}>Fermer</Button>}
      </div>
      <ErrorText error={error} />
      {status && status.lines.length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-lg bg-raised p-3 font-mono text-[12px] text-ink-soft">{status.lines.join('\n')}</pre>
      )}
    </div>
  );
}
