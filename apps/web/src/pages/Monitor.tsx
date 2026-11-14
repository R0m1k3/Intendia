import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { PageHeader } from '../components/Layout';
import { ModuleNotice, useModuleAvailability, type OpRef } from '../components/ModuleNotice';
import { ProfileSelect } from '../components/ProfileSelect';
import { Chips } from '../components/ui';
import { Logs } from '../monitor/Logs';
import { System } from '../monitor/System';
import { Usage, type Period } from '../monitor/Usage';
import { t } from '../i18n';

export const MONITOR_TABS = ['usage', 'logs', 'server'] as const;
export type MonitorTab = (typeof MONITOR_TABS)[number];
export interface MonitorSearch { tab?: MonitorTab; days?: Period; file?: string; profile?: string }

const REQUIRED: OpRef[] = [['monitor', 'usage']];
const TAB_LABEL: Record<MonitorTab, string> = { usage: t('Utilisation'), logs: t('Journaux'), server: t('Serveur') };
const TAB_OP: Record<MonitorTab, string> = { usage: 'usage', logs: 'logs', server: 'system' };

export function MonitorPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as MonitorSearch;
  const navigate = useNavigate();
  const { has } = useModuleAvailability(inst, 'monitor', REQUIRED, []);
  const tabs = MONITOR_TABS.filter((k) => has('monitor', TAB_OP[k]));
  const tab = search.tab && tabs.includes(search.tab) ? search.tab : tabs[0];
  const profile = search.profile ?? 'default';
  const go = (s: Partial<MonitorSearch>) => void navigate({ to: '/i/$inst/suivi', params: { inst }, search: { ...search, ...s } });
  return (
    <div className="pb-14">
      <PageHeader
        title={t('Suivi')}
        subtitle={t('Utilisation, journaux et métriques du serveur Hermes')}
        action={tab !== 'server' ? <ProfileSelect inst={inst} value={profile} onChange={(p) => go({ profile: p === 'default' ? undefined : p })} /> : undefined}
      />
      <div className="space-y-4 px-4 md:px-8">
        <ModuleNotice instanceId={inst} module="monitor" title={t('Le suivi')} required={REQUIRED}
          optional={[['monitor', 'logs', t('Journaux')], ['monitor', 'system', t('Métriques du serveur')], ['monitor', 'sessionStats', t('Sessions par source')]]} />
        {tab && (
          <>
            <Chips role="tab" label={t('Sections')} value={tab} items={tabs.map((k) => ({ key: k, label: TAB_LABEL[k] }))} onChange={(k) => go({ tab: k })} />
            {tab === 'usage' && <Usage key={`${inst}:${profile}`} inst={inst} profile={profile} days={search.days ?? 30} onDays={(d) => go({ days: d })} />}
            {tab === 'logs' && <Logs key={`${inst}:${profile}`} inst={inst} profile={profile} file={search.file ?? 'agent'} onFile={(f) => go({ file: f })} />}
            {tab === 'server' && <System inst={inst} />}
          </>
        )}
      </div>
    </div>
  );
}
