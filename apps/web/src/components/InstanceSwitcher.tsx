import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Settings2 } from 'lucide-react';
import { api, type CompatReport, type PublicInstance } from '../api';
import { failedCount } from '../home/summary';
import { useCurrentInstance } from '../instance/current';
import { Popover } from './Menu';
import { cx, Mark, worst } from './ui';
import { plural, t } from '../i18n';

/** What needs a look on each instance: crons whose last run failed, runs waiting for approval. */
export function useAlerts(): (id: string) => { failed: number; approvals: number } {
  const overview = useQuery({ queryKey: ['crons-overview'], queryFn: () => api.cronsOverview(), refetchInterval: 60_000 });
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), refetchInterval: 10_000, refetchIntervalInBackground: true });
  return (id) => ({
    failed: failedCount((overview.data?.crons ?? []).filter((c) => c.instanceId === id)),
    approvals: (approvals.data?.approvals ?? []).filter((a) => a.instanceId === id).length,
  });
}

function alertLabel({ failed, approvals }: { failed: number; approvals: number }): string | null {
  const parts = [
    approvals ? plural(approvals, '{n} approbation en attente', '{n} approbations en attente') : '',
    failed ? plural(failed, '{n} cron en échec', '{n} crons en échec') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function Alert({ n, label }: { n: number; label: string | null }) {
  if (!n || !label) return null;
  return (
    <span className="shrink-0 rounded-full bg-bad-soft px-1.5 font-mono text-[11px] leading-[18px] text-bad" title={label} aria-label={label}>
      {n}
    </span>
  );
}

function Line({ instance, report }: { instance: PublicInstance; report?: CompatReport }) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Mark state={report ? worst(report.modules.map((m) => m.state)) : null} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{instance.label}</span>
      {report?.hermesVersion && <span className="shrink-0 font-mono text-[11px] text-ink-faint">v{report.hermesVersion.replace(/^v/, '')}</span>}
    </>
  );
}

const BLOCK = 'flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-sheet px-3 text-sm transition-colors';

/**
 * The current instance, at the top of the sidebar (and of the phone's "Plus" sheet). With two instances or more, a
 * list to change it; the block counts what waits on the other instances.
 */
export function InstanceSwitcher({ className, onPicked }: { className?: string; onPicked?: () => void }) {
  const { id, instance, instances, select } = useCurrentInstance();
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 60_000 });
  const alerts = useAlerts();
  if (!instance) return null;
  const report = (i: string) => compat.data?.reports.find((r) => r.instanceId === i);

  if (instances.length < 2) {
    return (
      <Link to="/etat" hash={instance.id} data-instance-switcher="" className={cx(BLOCK, 'hover:bg-raised', className)} title={t('État de l’instance')}>
        <Line instance={instance} report={report(instance.id)} />
      </Link>
    );
  }

  const others = instances.filter((i) => i.id !== id).map((i) => alerts(i.id));
  const elsewhere = { failed: others.reduce((n, a) => n + a.failed, 0), approvals: others.reduce((n, a) => n + a.approvals, 0) };
  const elsewhereLabel = alertLabel(elsewhere);
  return (
    <div className={className} data-instance-switcher="">
      <Popover
        title={t('Changer d’instance')} placement="below" width={300}
        triggerClass={cx(BLOCK, 'hover:bg-raised aria-expanded:bg-raised')}
        trigger={(
          <>
            <Line instance={instance} report={report(instance.id)} />
            <Alert n={elsewhere.failed + elsewhere.approvals} label={elsewhereLabel && t('Sur les autres instances : {alerts}', { alerts: elsewhereLabel })} />
            <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
          </>
        )}
      >
        {(close) => (
          <>
            <p role="presentation" className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-faint">{t('Instances')}</p>
            {instances.map((i) => {
              const a = alerts(i.id);
              return (
                <button
                  key={i.id} type="button" role="menuitemradio" aria-checked={i.id === id} data-instance={i.id}
                  onClick={() => { close(); if (i.id !== id) select(i.id); onPicked?.(); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-raised focus:bg-raised focus:outline-none"
                >
                  <Line instance={i} report={report(i.id)} />
                  <Alert n={a.failed + a.approvals} label={alertLabel(a)} />
                  <Check className={cx('size-3.5 shrink-0 text-accent-ink', i.id !== id && 'invisible')} strokeWidth={1.75} />
                </button>
              );
            })}
            <div className="mt-1 border-t border-line pt-1">
              <Link
                to="/reglages" role="menuitem" onClick={() => { close(); onPicked?.(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-raised hover:text-ink focus:bg-raised focus:outline-none"
              >
                <Settings2 className="size-4 shrink-0" strokeWidth={1.5} />
                {t('Gérer les instances')}
              </Link>
            </div>
          </>
        )}
      </Popover>
    </div>
  );
}
