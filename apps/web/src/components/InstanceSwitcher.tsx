import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Plus, Settings2 } from 'lucide-react';
import { api, type CompatReport, type PublicInstance } from '../api';
import { useFailuresSeen } from '../crons/failuresSeen';
import { useCurrentInstance } from '../instance/current';
import { Popover } from './Menu';
import { cx, Mark, worst } from './ui';
import { plural, t } from '../i18n';
import { useApprovals } from './useApprovals';

/** What needs a look on each instance: crons whose last run failed (not seen yet on Planning), runs waiting for approval. */
export function useAlerts(): (id: string) => { failed: number; approvals: number } {
  const overview = useQuery({ queryKey: ['crons-overview'], queryFn: () => api.cronsOverview(), refetchInterval: 60_000 });
  const approvals = useApprovals();
  const { unseen } = useFailuresSeen();
  return (id) => ({
    failed: unseen(id, (overview.data?.crons ?? []).filter((c) => c.instanceId === id)),
    approvals: (approvals.data?.approvals ?? []).filter((a) => a.instanceId === id).length,
  });
}

function alertLabel({ failed, approvals }: { failed: number; approvals: number }): string | null {
  const parts = [
    approvals ? plural(approvals, '{n} approbation en attente', '{n} approbations en attente') : '',
    failed ? plural(failed, '{n} planification en échec', '{n} planifications en échec') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function Alert({ n, label }: { n: number; label: string | null }) {
  if (!n || !label) return null;
  return (
    <span className="shrink-0 rounded-full bg-bad-soft px-1.5 font-mono text-[11px] leading-[18px] text-bad" title={label} role="img" aria-label={label}>
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

/** Two letters of an instance's name for its tile: « Hermes simulé » → « HS », « maison » → « MA ». */
export function instanceInitials(label: string): string {
  const words = label.split(/[\s_.-]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : label.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The servers column of the rail (OpenBot's server rail): one tile per Hermes instance, the current one marked; a dot
 * for its state (compatibility), a red count of what waits there (approvals, failed crons). A click changes this tab's
 * instance; « + » goes to the instances' settings.
 */
export function InstanceRail() {
  const { id, instances, select } = useCurrentInstance();
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat, refetchInterval: 60_000 });
  const alerts = useAlerts();
  return (
    <nav aria-label={t('Instances')} data-instance-rail="" className="flex w-full flex-col items-center gap-1.5">
      {instances.map((i) => {
        const report = compat.data?.reports.find((r) => r.instanceId === i.id);
        const a = alerts(i.id);
        const n = a.failed + a.approvals;
        const label = alertLabel(a);
        const on = i.id === id;
        const version = report?.hermesVersion ? ` · v${report.hermesVersion.replace(/^v/, '')}` : '';
        return (
          <div key={i.id} className="relative flex w-full justify-center">
            <span aria-hidden className={cx('absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-ink transition-all', on ? 'h-7' : 'h-0')} />
            <button type="button" data-instance={i.id} aria-pressed={on} onClick={() => { if (!on) select(i.id); }}
              title={`${i.label}${version}${label ? ` · ${label}` : ''}`} aria-label={label ? `${i.label} (${label})` : i.label}
              className={cx('relative flex size-10 items-center justify-center rounded-[12px] text-[13px] font-semibold transition-all',
                on ? 'bg-ink text-sheet' : 'bg-sheet text-ink-soft shadow-[0_0_0_1px_var(--color-line)] hover:rounded-[10px] hover:text-ink')}>
              {instanceInitials(i.label)}
              <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-paper">
                <Mark state={report ? worst(report.modules.map((m) => m.state)) : null} />
              </span>
              {/* the current instance already shows them (Planning, « Vous attend »): only the others count here */}
              {n > 0 && !on && (
                <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center font-mono text-[10.5px] leading-[18px] text-sheet ring-2 ring-paper">{n}</span>
              )}
            </button>
          </div>
        );
      })}
      <Link to="/reglages" title={t('Gérer les instances')} aria-label={t('Gérer les instances')}
        className="flex size-10 items-center justify-center rounded-[12px] border border-dashed border-line text-ink-faint transition-colors hover:border-ink-faint hover:text-ink">
        <Plus className="size-4" strokeWidth={1.75} />
      </Link>
    </nav>
  );
}
