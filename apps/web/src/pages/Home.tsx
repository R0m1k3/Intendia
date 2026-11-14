import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { api } from '../api';
import { configKey } from '../config/common';
import { Panel } from '../components/ui';
import { Ask } from '../home/Ask';
import { useCurrentInstance } from '../instance/current';
import { InstancePick } from '../chat/InstancePick';
import { t } from '../i18n';

/**
 * Screen of the session list when no session is open: an empty chat, the box to write at the bottom like in a session
 * (Michael, 2026-11-12: no status or cron cards here; the instance state is on /etat, the crons on /crons).
 */
export function HomePage() {
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const { id, instance, select } = useCurrentInstance();
  const [attached, setAttached] = useState(0);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const search = useSearch({ from: '/app/inbox/' });
  const navigate = useNavigate();
  const list = instances.data?.instances ?? [];
  const ws = (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === id);
  const pickable = list.map((i) => ({ id: i.id, label: i.label, workspaces: (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === i.id).length }));
  const focused = useCallback(() => { void navigate({ to: '/', search: {}, replace: true }); }, [navigate]);
  // no main model on the current instance: the setup was skipped (model/info only: never writes; error → nothing)
  const info = useQuery({ queryKey: configKey(id ?? '', 'default', 'model-info'), queryFn: () => api.modelInfo(id!), enabled: Boolean(id), retry: false, staleTime: 60_000 });

  return (
    <div data-home className="flex min-h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom))] flex-col md:min-h-[var(--content-h)]">
      {id && info.isSuccess && !info.data.model && (
        <div className="px-4 pt-4 md:px-8" data-finish-setup>
          <div className="mx-auto flex max-w-[920px] flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{instance && list.length > 1 ? t('L’agent de {label} n’a pas de modèle principal : il ne pourra pas répondre.', { label: instance.label }) : t('L’agent n’a pas de modèle principal : il ne pourra pas répondre.')}</span>
            <Link to="/installation/fournisseur" search={{ inst: id }}
              className="inline-flex h-[34px] items-center rounded-lg border border-accent-strong bg-accent px-3.5 text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-strong">
              {t('Terminer l’installation')}
            </Link>
          </div>
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
        {/* where the first message goes; outside the branches below, so it stays when the instance has no workspace */}
        {workspaces.isSuccess && pickable.length > 1 && (
          <div className="mb-5"><InstancePick value={id} instances={pickable} allowEmpty disabled={attached > 0} onPick={select} /></div>
        )}
        {instances.isSuccess && list.length === 0 ? (
          <Panel>
            <p className="text-sm text-ink-soft">{t('Intendia n’est relié à aucune instance Hermes pour l’instant')}</p>
            <Link
              to={instances.data.declarative ? '/reglages' : '/installation'}
              className="mt-4 inline-flex h-[34px] items-center rounded-lg border border-accent-strong bg-accent px-3.5 text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-strong"
            >
              {t('Ajouter une instance')}
            </Link>
          </Panel>
        ) : workspaces.isSuccess && list.length > 0 && ws.length === 0 ? (
          <Panel>
            <p className="text-[15px]">{instance && list.length > 1 ? t('Commencez par un workspace sur {label}', { label: instance.label }) : t('Commencez par un workspace')}</p>
            <p className="mt-1 text-sm text-ink-soft">{t('Un dossier partagé avec l’agent, ses consignes et ses sessions de travail')}</p>
            <Link to="/w" className="mt-4 inline-flex h-[34px] items-center rounded-lg border border-accent-strong bg-accent px-3.5 text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-strong">
              {t('Créer un workspace')}
            </Link>
          </Panel>
        ) : (
          <p className="text-sm text-ink-faint">{instance && list.length > 1 ? t('Nouvelle session sur {label}', { label: instance.label }) : t('Nouvelle session')}</p>
        )}
      </div>
      {list.length > 0 && ws.length > 0 && (
        <div className="sticky bottom-0 bg-linear-to-t from-sheet from-70% to-transparent px-4 pt-4 pb-4 md:px-8">
          <div className="mx-auto max-w-[920px]">
            <Ask key={id} workspaces={ws} focus={search.nouvelle === 1} onFocused={focused} onAttachmentsChange={setAttached} />
          </div>
        </div>
      )}
    </div>
  );
}
