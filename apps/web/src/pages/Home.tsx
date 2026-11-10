import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, CalendarClock, RotateCw } from 'lucide-react';
import { describe, whenFr } from '../crons/schedule';
import { api, type CompatReport, type PublicInstance } from '../api';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, host, MODULE_META, Panel, StateMark, timeAgo } from '../components/ui';

function Link2({ name, url, ok, detail }: { name: string; url: string | null; ok: boolean | null; detail?: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-sm">
      <span className="text-ink-soft">{name}</span>
      {url ? <span className="truncate font-mono text-xs text-ink-faint">{host(url)}</span> : null}
      <span className={cx(ok === false ? 'text-bad' : 'text-ink')}>{detail}</span>
    </div>
  );
}

/** The instance sheet: one register line per module, the moment of the home page. */
function InstanceSheet({ instance, report }: { instance: PublicInstance; report?: CompatReport }) {
  const qc = useQueryClient();
  const recheck = useMutation({
    mutationFn: () => api.recheck(instance.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compat'] }),
  });

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-sheet">
      <header className="flex flex-wrap items-start justify-between gap-4 p-5 md:p-6">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-medium">{instance.label}</h2>
            <span className="font-mono text-xs text-ink-faint">
              {report?.hermesVersion ? `Hermes ${report.hermesVersion}` : 'Hermes ?'} · {instance.id}
            </span>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
            <Link2 name="API server" url={instance.api} ok={report ? report.api.reachable : null}
              detail={!report ? '…' : report.api.reachable ? 'joignable' : 'injoignable'} />
            <Link2 name="Dashboard" url={instance.dashboard} ok={report && report.dash.configured ? report.dash.reachable : null}
              detail={!report ? '…' : !report.dash.configured ? 'non configuré' : report.dash.reachable ? 'joignable' : 'injoignable'} />
          </div>
        </div>
        <Button onClick={() => recheck.mutate()} disabled={recheck.isPending}>
          <RotateCw className={cx('size-4', recheck.isPending && 'animate-spin')} strokeWidth={1.5} />
          {recheck.isPending ? 'Vérification…' : 'Revérifier'}
        </Button>
      </header>

      {recheck.error ? <div className="px-5 pb-4 md:px-6"><ErrorText error={recheck.error} /></div> : null}

      {!report ? (
        <p className="border-t border-line px-6 py-8 text-sm text-ink-soft">Vérification en cours…</p>
      ) : (
        <ol className="grid grid-cols-2 gap-px border-y border-line bg-line xl:grid-cols-4">
          {report.modules.map((m) => {
            const meta = MODULE_META[m.id];
            const Icon = meta?.icon;
            return (
              <li key={m.id} className="bg-sheet">
                <Link
                  to="/etat"
                  hash={`${instance.id}-${m.id}`}
                  className="group flex h-full flex-col gap-3 p-4 transition-colors hover:bg-raised/50 sm:p-5"
                >
                  {Icon && <Icon className="size-4 text-ink-faint transition-colors group-hover:text-ink-soft" strokeWidth={1.5} />}
                  <div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="mt-0.5 text-[13px] text-ink-soft">{meta?.does}</div>
                  </div>
                  <div className="mt-auto">
                    <StateMark state={m.state} quiet />
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-ink-faint md:px-6">
        <span>
          {report ? `Vérifié ${timeAgo(report.checkedAt)}` : 'Pas encore vérifié'} · au démarrage, à chaque version d’Hermes et chaque jour
        </span>
        <Link to="/etat" hash={instance.id} className="inline-flex items-center gap-1 text-ink-soft transition-colors hover:text-ink">
          Routes utilisées
          <ArrowRight className="size-3.5" strokeWidth={1.5} />
        </Link>
      </footer>
    </section>
  );
}

function RecentWorkspaces() {
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const list = workspaces.data?.workspaces ?? [];
  if (!workspaces.isSuccess) return null;
  if (list.length === 0) {
    return (
      <Panel>
        <p className="text-[15px]">Commencez par un workspace</p>
        <p className="mt-1 text-sm text-ink-soft">Un dossier partagé avec l’agent, ses consignes et ses sessions de travail</p>
        <Link to="/w" className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong">
          Créer un workspace
        </Link>
      </Panel>
    );
  }
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-medium">Workspaces</h2>
        <Link to="/w" className="inline-flex items-center gap-1 text-xs text-ink-soft transition-colors hover:text-ink">
          Tous
          <ArrowRight className="size-3.5" strokeWidth={1.5} />
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {list.slice(0, 4).map((w) => (
          <li key={w.slug}>
            <Link to="/w/$slug" params={{ slug: w.slug }} className="flex h-full flex-col gap-1 rounded-xl border border-line bg-sheet p-4 transition-colors hover:bg-raised/50">
              <span className="text-sm font-medium">{w.name}</span>
              <span className="font-mono text-[11px] text-ink-faint">{w.slug} · {w.profile ?? 'default'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Next three active crons across instances; hidden when there are none. */
function UpcomingCrons() {
  const up = useQuery({ queryKey: ['upcoming-crons'], queryFn: api.upcomingCrons, refetchInterval: 60_000 });
  const list = up.data?.upcoming ?? [];
  if (list.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-medium">Prochains crons</h2>
        <Link to="/crons" className="inline-flex items-center gap-1 text-xs text-ink-soft transition-colors hover:text-ink">
          Tous
          <ArrowRight className="size-3.5" strokeWidth={1.5} />
        </Link>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line bg-sheet">
        {list.map((c) => (
          <li key={`${c.instanceId}/${c.id}`}>
            <Link to="/i/$inst/crons" params={{ inst: c.instanceId }} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-raised/50">
              <CalendarClock className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
              <span className="text-[13px] text-ink-soft">{whenFr(c.nextRunAt)}</span>
              <span className="w-full pl-8 font-mono text-[11px] text-ink-faint sm:w-auto sm:pl-0">{describe(c.schedule)} · {c.instanceLabel}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function summary(reports: CompatReport[], count: number): string {
  if (count === 0) return 'Aucune instance Hermes';
  const mods = reports.flatMap((r) => r.modules);
  const full = mods.filter((m) => m.state === 'full').length;
  const inst = `${count} instance${count > 1 ? 's' : ''} Hermes`;
  if (mods.length === 0) return inst;
  return full === mods.length ? `${inst} · ${mods.length} modules complets` : `${inst} · ${full} modules complets sur ${mods.length}`;
}

export function HomePage() {
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const list = instances.data?.instances ?? [];
  const reports = compat.data?.reports ?? [];

  return (
    <>
      <PageHeader title="Accueil" subtitle={instances.isSuccess ? summary(reports, list.length) : undefined} />
      <div className="space-y-6 px-5 pb-12 md:px-8">
        {instances.isSuccess && list.length === 0 && (
          <Panel>
            <p className="text-sm text-ink-soft">Intendia n’est relié à aucune instance Hermes pour l’instant</p>
            <Link
              to={instances.data.declarative ? '/reglages' : '/installation'}
              className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong"
            >
              Ajouter une instance
            </Link>
          </Panel>
        )}
        {list.length > 0 && <RecentWorkspaces />}
        {list.length > 0 && <UpcomingCrons />}
        {list.map((i) => (
          <InstanceSheet key={i.id} instance={i} report={reports.find((r) => r.instanceId === i.id)} />
        ))}
      </div>
    </>
  );
}
