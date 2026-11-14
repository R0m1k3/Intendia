import { useQuery } from '@tanstack/react-query';
import { api, type ModuleState, type Platform } from '../api';
import { ErrorText, Mark, Panel } from '../components/ui';
import { configKey, type TabProps } from './common';
import { t } from '../i18n';

const EMPTY = new Set(['disabled', 'startup_failed', 'error']);
const HALF = new Set(['not_configured', 'pending_restart', 'gateway_stopped', 'connecting']);
const FULL = new Set(['connected', 'running', 'ok', 'ready']);

const STATE_LABEL: Record<string, string> = {
  connected: t('connectée'), running: t('en marche'), disabled: t('désactivée'), startup_failed: t('échec au démarrage'), error: t('en erreur'),
  not_configured: t('non configurée'), pending_restart: t('attend un redémarrage'), gateway_stopped: t('passerelle arrêtée'), connecting: t('connexion…'),
};

/** Read-only: states are not a closed list, so anything unknown is shown as half. */
export function platformMark(p: Platform): ModuleState {
  if (!p.enabled || p.errorMessage || (p.state && EMPTY.has(p.state))) return 'unavailable';
  if (!p.state || HALF.has(p.state) || !FULL.has(p.state)) return 'readonly';
  return 'full';
}

export function ConfigPlatforms({ inst, profile }: TabProps) {
  const platforms = useQuery({ queryKey: configKey(inst, profile, 'platforms'), queryFn: () => api.platforms(inst, profile).then((r) => r.platforms) });
  if (platforms.isPending) return <p className="text-sm text-ink-soft">{t('Lecture des plateformes…')}</p>;
  if (platforms.isError) return <ErrorText error={platforms.error} />;
  const list = platforms.data ?? [];
  return (
    <Panel title={t('Plateformes de messagerie')} bodyClassName="divide-y divide-line/70 border-t border-line/70">
      {list.length === 0 && <p className="p-5 text-sm text-ink-soft">{t('Aucune plateforme.')}</p>}
      {list.map((p) => (
        <div key={p.id} className="space-y-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Mark state={platformMark(p)} />
            <span className="flex-1 text-sm font-medium">{p.name}</span>
            <span className="text-xs text-ink-faint">
              {!p.enabled ? t('non activée') : p.state ? (STATE_LABEL[p.state] ?? p.state) : p.configured ? t('configurée') : t('non configurée')}
            </span>
          </div>
          {p.errorMessage && <p className="text-xs text-bad">{p.errorMessage}</p>}
          {p.env.length > 0 && (
            <p className="text-xs text-ink-faint">
              {p.env.map((e) => (e.isSet ? e.key : e.required ? t('{name} (manquante)', { name: e.key }) : t('{name} (vide)', { name: e.key }))).join(', ')}
            </p>
          )}
        </div>
      ))}
      <p className="px-4 py-3 text-xs text-ink-faint">{t('Lecture seule : les jetons se règlent dans l’onglet Variables, puis la passerelle doit redémarrer.')}</p>
    </Panel>
  );
}
