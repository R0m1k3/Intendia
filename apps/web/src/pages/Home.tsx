import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api';
import { PageHeader } from '../components/Layout';
import { Panel, StateBadge, timeAgo } from '../components/ui';

export function HomePage() {
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const list = instances.data?.instances ?? [];

  return (
    <>
      <PageHeader title="Accueil" subtitle="Vos instances Hermes et l’état de chaque module." />
      <div className="space-y-4 px-5 pb-10 md:px-8">
        {instances.isSuccess && list.length === 0 && (
          <Panel>
            <p className="text-sm">Aucune instance configurée.</p>
            <Link to={instances.data.declarative ? '/reglages' : '/installation'} className="mt-2 inline-block text-sm font-medium text-accent">
              Ajouter une instance →
            </Link>
          </Panel>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((i) => {
            const r = compat.data?.reports.find((x) => x.instanceId === i.id);
            const degraded = r?.modules.filter((m) => m.state !== 'full') ?? [];
            return (
              <Panel
                key={i.id}
                title={i.label}
                action={<span className="font-mono text-xs text-ink-faint">{r?.hermesVersion ? `Hermes ${r.hermesVersion}` : '…'}</span>}
              >
                {!r ? (
                  <p className="text-sm text-ink-soft">Vérification en cours…</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
                      <span>API server : {r.api.reachable ? 'joignable' : 'injoignable'}</span>
                      <span>Dashboard : {!r.dash.configured ? 'non configuré' : r.dash.reachable ? 'joignable' : 'injoignable'}</span>
                      <span>Vérifié {timeAgo(r.checkedAt)}</span>
                    </div>
                    <p className="mt-3 text-sm">
                      {degraded.length === 0
                        ? `Les ${r.modules.length} modules sont complets.`
                        : `${degraded.length} module${degraded.length > 1 ? 's' : ''} sur ${r.modules.length} dégradé${degraded.length > 1 ? 's' : ''} :`}
                    </p>
                    {degraded.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {degraded.map((m) => (
                          <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                            <span>{m.label}</span>
                            <StateBadge state={m.state} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link to="/etat" hash={i.id} className="mt-3 inline-block text-sm font-medium text-accent">Détail →</Link>
                  </>
                )}
              </Panel>
            );
          })}
        </div>
      </div>
    </>
  );
}
