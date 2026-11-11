import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import { describe, whenFr } from '../crons/schedule';
import { api, type CompatReport, type OverviewCron, type PublicInstance } from '../api';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, Mark, Panel, timeAgo, worst } from '../components/ui';
import { Ask } from '../home/Ask';
import { RecentSessions } from '../home/Recent';
import { CronTimeline } from '../home/Timeline';
import { FAILED, failureLabel } from '../home/summary';
import { Toggle } from '../home/Toggle';
import { useStoredFlag } from '../components/useStoredFlag';

function today(): string {
  const d = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function Reach({ name, ok, detail }: { name: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-ink-soft">{name}</span>
      <span className={cx('flex items-center gap-1.5', ok === false ? 'text-bad' : 'text-ink')}>
        {ok !== null && <span className={cx('size-1.5 rounded-full', ok ? 'bg-ok' : 'bg-bad')} aria-hidden />}
        {detail}
      </span>
    </div>
  );
}

/** One compact card per instance: version, the two endpoints, the module count (details on /etat), "Revérifier". */
function InstanceCard({ instance, report }: { instance: PublicInstance; report?: CompatReport }) {
  const qc = useQueryClient();
  const recheck = useMutation({
    mutationFn: () => api.recheck(instance.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compat'] }),
  });
  const mods = report?.modules ?? [];
  const full = mods.filter((m) => m.state === 'full').length;
  return (
    <section data-instance={instance.id} className="card p-5" aria-label={`Instance ${instance.label}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">{instance.label}</h2>
          <p className="font-mono text-xs text-ink-faint">{report?.hermesVersion ? `Hermes ${report.hermesVersion}` : 'Hermes ?'}</p>
        </div>
        <Button onClick={() => recheck.mutate()} disabled={recheck.isPending} className="h-8 px-2.5 text-xs">
          <RotateCw className={cx('size-3.5', recheck.isPending && 'animate-spin')} strokeWidth={1.5} />
          {recheck.isPending ? 'Vérification…' : 'Revérifier'}
        </Button>
      </header>
      <div className="mt-4 space-y-1.5">
        <Reach name="API server" ok={report ? report.api.reachable : null} detail={!report ? '…' : report.api.reachable ? 'joignable' : 'injoignable'} />
        <Reach
          name="Dashboard" ok={report && report.dash.configured ? report.dash.reachable : null}
          detail={!report ? '…' : !report.dash.configured ? 'non configuré' : report.dash.reachable ? 'joignable' : 'injoignable'}
        />
      </div>
      <ErrorText error={recheck.error} />
      <Link to="/etat" hash={instance.id} className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-xs text-ink-soft transition-colors hover:text-ink">
        {mods.length > 0 && <Mark state={worst(mods.map((m) => m.state))} />}
        {!report ? 'Pas encore vérifié' : `${full === mods.length ? `${full} modules complets` : `${full} modules complets sur ${mods.length}`} · vérifié ${timeAgo(report.checkedAt)}`}
      </Link>
    </section>
  );
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Reduced (default): the next active cron and one red line counting the failures. Enlarged: the 3 next crons, then a
 * red line per cron whose last run failed. Hidden when there is neither.
 */
function UpcomingCrons({ crons }: { crons: OverviewCron[] }) {
  const [open, setOpen] = useStoredFlag('intendia-home-upcoming-open');
  const list = crons.filter((c): c is OverviewCron & { nextRunAt: string } => c.nextRunAt !== null).slice(0, open ? 3 : 1);
  const failed = crons.filter((c) => FAILED.has(c.lastStatus ?? ''));
  if (list.length === 0 && failed.length === 0) return null;
  return (
    <section className="overflow-hidden card" aria-labelledby="crons-title" data-collapsed={open ? undefined : ''}>
      <header className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 id="crons-title" className="text-[15px] font-semibold">Prochains crons</h2>
          <Toggle open={open} onToggle={() => setOpen(!open)} controls="upcoming-body" />
        </div>
        <Link to="/crons" className="text-[13px] font-medium text-accent hover:underline">Gérer</Link>
      </header>
      <ul id="upcoming-body" className="divide-y divide-line border-t border-line">
        {list.map((c) => (
          <li key={`${c.instanceId}/${c.id}`}>
            <Link to="/i/$inst/crons" params={{ inst: c.instanceId }} className="flex items-baseline gap-3 px-5 py-3 transition-colors hover:bg-raised/50">
              <span className="w-24 shrink-0 font-mono text-xs text-ink-soft">{whenFr(c.nextRunAt)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block truncate text-xs text-ink-faint">{describe(c.schedule)}</span>
              </span>
            </Link>
          </li>
        ))}
        {!open && failed.length > 0 && (
          <li data-cron-failure-summary>
            <Link to="/crons" className="flex items-center gap-2.5 bg-bad-soft/60 px-5 py-3 text-[13px] font-medium text-bad transition-colors hover:bg-bad-soft">
              <TriangleAlert className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              {failureLabel(failed.length)}
            </Link>
          </li>
        )}
        {open && failed.map((c) => (
          <li key={`f:${c.instanceId}/${c.id}`} data-cron-failure>
            <Link to="/i/$inst/crons" params={{ inst: c.instanceId }} className="flex items-start gap-2.5 bg-bad-soft/60 px-5 py-3 text-bad transition-colors hover:bg-bad-soft">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1 text-[13px]">
                <span className="font-medium">Échec · {c.name}</span>
                {c.lastError && <span className="text-bad/90"> ({cut(c.lastError.replace(/\s+/g, ' '), 80)})</span>}
                <span className="block text-xs text-bad/80">{whenFr(c.lastRunAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HomePage() {
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const overview = useQuery({ queryKey: ['crons-overview'], queryFn: api.cronsOverview, refetchInterval: 60_000 });
  const crons = overview.data?.crons ?? [];
  const search = useSearch({ from: '/app/' });
  const navigate = useNavigate();
  const list = instances.data?.instances ?? [];
  const reports = compat.data?.reports ?? [];
  const ws = workspaces.data?.workspaces ?? [];
  const focused = useCallback(() => { void navigate({ to: '/', search: {}, replace: true }); }, [navigate]);

  return (
    <>
      <PageHeader eyebrow={today()} title="Accueil" />
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
        {list.length > 0 && workspaces.isSuccess && (ws.length > 0 ? (
          <Ask workspaces={ws} focus={search.nouvelle === 1} onFocused={focused} />
        ) : (
          <Panel>
            <p className="text-[15px]">Commencez par un workspace</p>
            <p className="mt-1 text-sm text-ink-soft">Un dossier partagé avec l’agent, ses consignes et ses sessions de travail</p>
            <Link to="/w" className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong">
              Créer un workspace
            </Link>
          </Panel>
        ))}
        {list.length > 0 && <CronTimeline crons={crons} />}
        {list.length > 0 && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <RecentSessions />
            <div className="space-y-6">
              <UpcomingCrons crons={crons} />
              {list.map((i) => <InstanceCard key={i.id} instance={i} report={reports.find((r) => r.instanceId === i.id)} />)}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
