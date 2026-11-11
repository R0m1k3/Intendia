import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronRight, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { api, type CompatReport, type ModuleReport } from '../api';
import { useCurrentInstance } from '../instance/current';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, MODULE_META, Panel, StateMark, timeAgo } from '../components/ui';

function ModuleRow({ m, anchor }: { m: ModuleReport; anchor: string }) {
  const [open, setOpen] = useState(m.state !== 'full' || window.location.hash === `#${anchor}`);
  const Icon = MODULE_META[m.id]?.icon;
  return (
    <li id={anchor} className="scroll-mt-6">
      <button
        className="flex h-12 w-full items-center gap-3 px-5 text-left transition-colors hover:bg-raised/50"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRight className={cx('size-4 shrink-0 text-ink-faint transition-transform duration-150', open && 'rotate-90')} strokeWidth={1.5} />
        {Icon && <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />}
        <span className="text-sm font-medium">{m.label}</span>
        <span className="hidden truncate text-[13px] text-ink-faint sm:inline">{MODULE_META[m.id]?.does}</span>
        <span className="ml-auto"><StateMark state={m.state} quiet /></span>
      </button>
      {open && (
        <div className="space-y-3 pb-4 pl-[68px] pr-5">
          {m.reasons.length > 0 && (
            <ul className="space-y-1 text-sm text-ink-soft">
              {m.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {m.state !== 'full' && m.dashboardLink && (
            <a href={m.dashboardLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-strong">
              Ouvrir dans le dashboard officiel
              <ArrowUpRight className="size-4" strokeWidth={1.5} />
            </a>
          )}
          <table className="w-full text-xs">
            <tbody className="divide-y divide-line">
              {Object.entries(m.ops).map(([name, op]) => (
                <tr key={name} className="align-top">
                  <td className="w-36 py-2 pr-4 text-ink-soft">{name}</td>
                  <td className="whitespace-pre-wrap py-2 font-mono">
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

function InstanceStatus({ report, label }: { report: CompatReport; label: string }) {
  const qc = useQueryClient();
  const recheck = useMutation({
    mutationFn: () => api.recheck(report.instanceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compat'] }),
  });
  const dash = !report.dash.configured
    ? 'non configuré'
    : report.dash.reachable
      ? `joignable${report.dash.openapi ? ', OpenAPI lue' : ', sans OpenAPI'}`
      : `injoignable (${report.dash.error ?? '?'})`;
  return (
    <Panel
      bodyClassName=""
      title={
        <span id={report.instanceId} className="scroll-mt-6">
          {label}
          <span className="ml-3 font-mono text-xs font-normal text-ink-faint">Hermes {report.hermesVersion ?? '?'}</span>
        </span>
      }
      action={
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-ink-faint sm:inline">Vérifié {timeAgo(report.checkedAt)}</span>
          <Button onClick={() => recheck.mutate()} disabled={recheck.isPending}>
            <RotateCw className={cx('size-4', recheck.isPending && 'animate-spin')} strokeWidth={1.5} />
            {recheck.isPending ? 'Vérification…' : 'Revérifier'}
          </Button>
        </div>
      }
    >
      {recheck.error ? <div className="px-5 pt-4"><ErrorText error={recheck.error} /></div> : null}
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-4 text-sm">
        <span><span className="text-ink-soft">API server</span> {report.api.reachable ? 'joignable' : <span className="text-bad">injoignable ({report.api.error ?? '?'})</span>}</span>
        <span><span className="text-ink-soft">Dashboard</span> {dash}</span>
        {report.socket && (
          <span data-socket={report.socket.sessionStats ? 'on' : 'off'}>
            <span className="text-ink-soft">Statistiques de session (WebSocket)</span> {report.socket.sessionStats ? 'disponibles' : 'indisponibles'}
            <span className="text-ink-faint"> · {report.socket.note}</span>
          </span>
        )}
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {report.modules.map((m) => <ModuleRow key={m.id} m={m} anchor={`${report.instanceId}-${m.id}`} />)}
      </ul>
    </Panel>
  );
}

export function StatusPage() {
  const { instance } = useCurrentInstance();
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 30_000 });
  return (
    <>
      <PageHeader
        title="État"
        subtitle="Chaque module est testé contre Hermes au démarrage, à chaque nouvelle version et chaque jour. Ouvrez un module pour voir les routes qu’il utilise."
      />
      <div className="space-y-6 px-5 pb-12 md:px-8">
        {(instance ? [instance] : []).map((i) => {
          const r = compat.data?.reports.find((x) => x.instanceId === i.id);
          return r
            ? <InstanceStatus key={i.id} report={r} label={i.label} />
            : <Panel key={i.id} title={i.label}><p className="text-sm text-ink-soft">Vérification en cours…</p></Panel>;
        })}
      </div>
    </>
  );
}
