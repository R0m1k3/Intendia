import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Check, ChevronRight, Eye, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { api, type CompatReport, type ModuleReport, type PublicInstance } from '../api';
import { useCurrentInstance } from '../instance/current';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, host, MODULE_META, Panel, Tag, timeAgo } from '../components/ui';

const STATE_TAG: Record<ModuleReport['state'], { label: string; tag: string; icon: string }> = {
  full: { label: 'complet', tag: '', icon: 'text-dot-ok' },
  readonly: { label: 'lecture seule', tag: 'bg-warn-soft text-warn', icon: 'text-warn' },
  unavailable: { label: 'indisponible', tag: 'bg-bad-soft text-bad', icon: 'text-bad' },
};

function ModuleRow({ m, anchor }: { m: ModuleReport; anchor: string }) {
  const [open, setOpen] = useState(m.state !== 'full' || window.location.hash === `#${anchor}`);
  const st = STATE_TAG[m.state];
  const StateIcon = m.state === 'full' ? Check : m.state === 'readonly' ? Eye : X;
  return (
    <li id={anchor} className="scroll-mt-6 border-t border-line/70">
      <button
        className="flex min-h-12 w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors hover:bg-paper"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <StateIcon className={cx('size-4 shrink-0', st.icon)} strokeWidth={1.75} aria-hidden />
        <span className="w-36 shrink-0 font-medium">{m.label}</span>
        <span className="hidden min-w-0 flex-1 truncate text-ink-faint sm:inline">{MODULE_META[m.id]?.does ?? ((m.id as string) === 'files' ? 'Fichiers des workspaces' : '')}</span>
        <span className="ml-auto flex items-center gap-2">
          <Tag className={st.tag}><span className="sr-only">État : </span>{st.label}</Tag>
          <ChevronRight className={cx('size-4 shrink-0 text-ink-faint transition-transform duration-150', open && 'rotate-90')} strokeWidth={1.5} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 pb-4 pl-[46px] pr-4">
          {m.reasons.length > 0 && (
            <ul className="space-y-1 text-sm text-ink-soft">
              {m.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {m.state !== 'full' && m.dashboardLink && (
            <a href={m.dashboardLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:text-ink">
              Ouvrir dans le dashboard officiel
              <ArrowUpRight className="size-4" strokeWidth={1.5} />
            </a>
          )}
          <table className="w-full rounded-lg bg-paper text-xs">
            <tbody className="divide-y divide-line/70">
              {Object.entries(m.ops).map(([name, op]) => (
                <tr key={name} className="align-top">
                  <td className="w-36 py-2 pl-3 pr-4 text-ink-soft">{name}</td>
                  <td className="whitespace-pre-wrap py-2 pr-3 font-mono">
                    {op.ok && op.route ? (
                      <>
                        <span className="text-ink-faint">{op.route.via === 'api' ? 'api ' : 'dash'}</span>{' '}
                        <span className="text-ink-soft">{op.route.method.padEnd(6, ' ')}</span>
                        <span>{op.route.path}</span>
                      </>
                    ) : <span className="text-bad">aucune route</span>}
                    {op.notes.length > 0 && <div className="mt-0.5 font-sans text-ink-faint">{op.notes.join(' · ')}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

/** One card per instance: dot, name, online tag, version and endpoints; the current one is outlined. */
function InstanceCard({ instance, report, current, onPick }: { instance: PublicInstance; report?: CompatReport; current: boolean; onPick: () => void }) {
  const online = report ? report.api.reachable : null;
  return (
    <button
      type="button" onClick={onPick} aria-pressed={current} data-instance-card={instance.id}
      className={cx('card px-[18px] py-4 text-left transition-colors hover:bg-paper', current && 'border-ink-faint/60', online === false && 'bg-paper')}
    >
      <span className="flex items-center gap-2.5">
        <span aria-hidden className={cx('size-2.5 shrink-0 rounded-full', online ? 'bg-dot-ok' : 'border-2 border-ink-faint')} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{instance.label}</span>
        <Tag className={online ? 'bg-ok-soft text-ok' : online === false ? 'bg-bad-soft text-bad' : undefined}>
          {online === null ? 'non vérifiée' : online ? 'en ligne' : 'hors ligne'}
        </Tag>
      </span>
      <span className="mt-1.5 block truncate font-mono text-xs text-ink-faint">
        {[report?.hermesVersion, host(instance.api), instance.dashboard ? host(instance.dashboard) : 'sans dashboard'].filter(Boolean).join(' · ')}
      </span>
    </button>
  );
}

function InstanceStatus({ report, label }: { report: CompatReport; label: string }) {
  const dash = !report.dash.configured
    ? 'non configuré'
    : report.dash.reachable
      ? `joignable${report.dash.openapi ? ', OpenAPI lue' : ', sans OpenAPI'}`
      : `injoignable (${report.dash.error ?? '?'})`;
  const full = report.modules.filter((m) => m.state === 'full').length;
  return (
    <section className="card overflow-hidden" aria-labelledby={`mods-${report.instanceId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-3">
        <h2 id={`mods-${report.instanceId}`} className="text-[15px] font-semibold">
          <span id={report.instanceId} className="scroll-mt-6">Modules de {label}</span>
        </h2>
        <span className="text-[13px] text-ink-faint">{full} sur {report.modules.length} complets · vérifié {timeAgo(report.checkedAt)}</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line/70 px-4 py-2.5 text-[13px]">
        <span><span className="text-ink-faint">API server</span> {report.api.reachable ? 'joignable' : <span className="text-bad">injoignable ({report.api.error ?? '?'})</span>}</span>
        <span><span className="text-ink-faint">Dashboard</span> {dash}</span>
        {report.socket && (
          <span data-socket={report.socket.sessionStats ? 'on' : 'off'}>
            <span className="text-ink-faint">Statistiques de session (WebSocket)</span> {report.socket.sessionStats ? 'disponibles' : 'indisponibles'}
            <span className="text-ink-faint"> · {report.socket.note}</span>
          </span>
        )}
        <span className="font-mono text-xs text-ink-faint">Hermes {report.hermesVersion ?? '?'}</span>
      </div>
      <ul>
        {report.modules.map((m) => <ModuleRow key={m.id} m={m} anchor={`${report.instanceId}-${m.id}`} />)}
      </ul>
    </section>
  );
}

export function StatusPage() {
  const { instance, instances, select } = useCurrentInstance();
  const qc = useQueryClient();
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 30_000 });
  const report = (id: string) => compat.data?.reports.find((x) => x.instanceId === id);
  const recheck = useMutation({
    mutationFn: () => api.recheck(instance!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compat'] }),
  });
  return (
    <>
      <PageHeader
        title="État des instances"
        subtitle="Chaque module est testé contre Hermes au démarrage, à chaque nouvelle version et chaque jour. Ouvrez un module pour voir les routes qu’il utilise."
        action={(
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => recheck.mutate()} disabled={recheck.isPending || !instance}>
              <RotateCw className={cx('size-4', recheck.isPending && 'animate-spin')} strokeWidth={1.5} />
              {recheck.isPending ? 'Vérification…' : 'Revérifier'}
            </Button>
            <Link to="/reglages" className="inline-flex h-[34px] items-center rounded-lg border border-ink bg-ink px-3.5 text-[13.5px] font-medium text-sheet hover:opacity-90">
              Ajouter une instance
            </Link>
          </div>
        )}
      />
      <div className="max-w-[1060px] space-y-5 px-4 pb-14 md:px-8">
        <ErrorText error={recheck.error} />
        {instances.length > 1 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
            {instances.map((i) => <InstanceCard key={i.id} instance={i} report={report(i.id)} current={i.id === instance?.id} onPick={() => select(i.id)} />)}
          </div>
        )}
        {instances.length === 1 && instance && <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3"><InstanceCard instance={instance} report={report(instance.id)} current={false} onPick={() => {}} /></div>}
        {(instance ? [instance] : []).map((i) => {
          const r = report(i.id);
          return r
            ? <InstanceStatus key={i.id} report={r} label={i.label} />
            : <Panel key={i.id} title={i.label}><p className="text-sm text-ink-soft">Vérification en cours…</p></Panel>;
        })}
      </div>
    </>
  );
}
