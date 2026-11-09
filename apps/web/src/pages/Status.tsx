import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CompatReport, type ModuleReport } from '../api';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, Panel, StateBadge, timeAgo } from '../components/ui';

function ModuleRow({ m }: { m: ModuleReport }) {
  const [open, setOpen] = useState(m.state !== 'full');
  return (
    <li className="py-3">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-sm font-medium">{m.label}</span>
        <span className="flex items-center gap-3">
          <StateBadge state={m.state} />
          <span className={cx('text-ink-faint transition-transform', open && 'rotate-90')} aria-hidden>›</span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {m.reasons.length > 0 && (
            <ul className="space-y-1 text-sm text-ink-soft">
              {m.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {m.state !== 'full' && m.dashboardLink && (
            <a href={m.dashboardLink} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-accent">
              Ouvrir cette page dans le dashboard officiel →
            </a>
          )}
          <table className="w-full text-xs">
            <tbody className="divide-y divide-line">
              {Object.entries(m.ops).map(([name, op]) => (
                <tr key={name} className="align-top">
                  <td className="w-40 py-1.5 pr-3 font-medium">{name}</td>
                  <td className="py-1.5 font-mono text-ink-soft">
                    {op.ok && op.route ? `${op.route.via === 'api' ? 'api' : 'dash'} ${op.route.method} ${op.route.path}` : <span className="text-bad">aucune route</span>}
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
  return (
    <Panel
      title={<span id={report.instanceId}>{label} <span className="ml-2 font-mono text-xs font-normal text-ink-faint">Hermes {report.hermesVersion ?? '?'}</span></span>}
      action={
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-ink-faint sm:inline">Vérifié {timeAgo(report.checkedAt)}</span>
          <Button onClick={() => recheck.mutate()} disabled={recheck.isPending}>{recheck.isPending ? 'Vérification…' : 'Revérifier'}</Button>
        </div>
      }
    >
      <ErrorText error={recheck.error} />
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
        <span>API server : {report.api.reachable ? 'joignable' : `injoignable (${report.api.error ?? '?'})`}</span>
        <span>
          Dashboard : {!report.dash.configured ? 'non configuré' : report.dash.reachable ? `joignable${report.dash.openapi ? ', OpenAPI lue' : ', sans OpenAPI'}` : `injoignable (${report.dash.error ?? '?'})`}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {report.modules.map((m) => <ModuleRow key={m.id} m={m} />)}
      </ul>
    </Panel>
  );
}

export function StatusPage() {
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 30_000 });
  return (
    <>
      <PageHeader
        title="État"
        subtitle="Test de compatibilité de chaque module : au démarrage, à chaque nouvelle version d’Hermes et chaque jour."
      />
      <div className="space-y-4 px-5 pb-10 md:px-8">
        {instances.data?.instances.map((i) => {
          const r = compat.data?.reports.find((x) => x.instanceId === i.id);
          return r ? <InstanceStatus key={i.id} report={r} label={i.label} /> : <Panel key={i.id} title={i.label}><p className="text-sm text-ink-soft">Vérification en cours…</p></Panel>;
        })}
      </div>
    </>
  );
}
