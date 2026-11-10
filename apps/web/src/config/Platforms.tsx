import { useQuery } from '@tanstack/react-query';
import { api, type ModuleState, type Platform } from '../api';
import { ErrorText, Mark, Panel } from '../components/ui';
import { configKey, type TabProps } from './common';

const EMPTY = new Set(['disabled', 'startup_failed', 'error']);
const HALF = new Set(['not_configured', 'pending_restart', 'gateway_stopped', 'connecting']);
const FULL = new Set(['connected', 'running', 'ok', 'ready']);

const STATE_LABEL: Record<string, string> = {
  connected: 'connectée', running: 'en marche', disabled: 'désactivée', startup_failed: 'échec au démarrage', error: 'en erreur',
  not_configured: 'non configurée', pending_restart: 'attend un redémarrage', gateway_stopped: 'passerelle arrêtée', connecting: 'connexion…',
};

/** Read-only: states are not a closed list, so anything unknown is shown as half. */
export function platformMark(p: Platform): ModuleState {
  if (!p.enabled || p.errorMessage || (p.state && EMPTY.has(p.state))) return 'unavailable';
  if (!p.state || HALF.has(p.state) || !FULL.has(p.state)) return 'readonly';
  return 'full';
}

export function ConfigPlatforms({ inst, profile }: TabProps) {
  const platforms = useQuery({ queryKey: configKey(inst, profile, 'platforms'), queryFn: () => api.platforms(inst, profile).then((r) => r.platforms) });
  if (platforms.isPending) return <p className="text-sm text-ink-soft">Lecture des plateformes…</p>;
  if (platforms.isError) return <ErrorText error={platforms.error} />;
  const list = platforms.data ?? [];
  return (
    <Panel title="Plateformes de messagerie" bodyClassName="divide-y divide-line">
      {list.length === 0 && <p className="p-5 text-sm text-ink-soft">Aucune plateforme.</p>}
      {list.map((p) => (
        <div key={p.id} className="space-y-1 px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Mark state={platformMark(p)} />
            <span className="flex-1 text-sm font-medium">{p.name}</span>
            <span className="text-xs text-ink-faint">
              {!p.enabled ? 'non activée' : p.state ? (STATE_LABEL[p.state] ?? p.state) : p.configured ? 'configurée' : 'non configurée'}
            </span>
          </div>
          {p.errorMessage && <p className="text-xs text-bad">{p.errorMessage}</p>}
          {p.env.length > 0 && (
            <p className="text-xs text-ink-faint">
              {p.env.map((e) => `${e.key}${e.isSet ? '' : e.required ? ' (manquante)' : ' (vide)'}`).join(', ')}
            </p>
          )}
        </div>
      ))}
      <p className="px-5 py-3 text-xs text-ink-faint">Lecture seule : les jetons se règlent dans l’onglet Variables, puis la passerelle doit redémarrer.</p>
    </Panel>
  );
}
