import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api, type CompatReport, type ModuleId } from '../api';
import { Mark } from './ui';

export type OpRef = [module: ModuleId, op: string];
export type OptionalOp = [module: ModuleId, op: string, label: string];

function op(report: CompatReport, module: string, name: string) {
  return report.modules.find((m) => m.id === module)?.ops[name];
}

/**
 * Availability from the operations a page uses (possibly from several modules), not from the module
 * state: a missing optional write must warn, a missing required read must block.
 */
export function useModuleAvailability(instanceId: string | undefined, module: ModuleId, required: OpRef[], optional: OptionalOp[], explainMissing = false) {
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const report = compat.data?.reports.find((r) => r.instanceId === instanceId);
  const has = (m: string, o: string) => (report ? Boolean(op(report, m, o)?.ok) : true);
  if (!report) return { available: true, missing: [] as string[], reasons: [] as string[], link: undefined as string | undefined, has };
  const blocked = required.filter(([m, o]) => !op(report, m, o)?.ok);
  const missingOps = optional.filter(([m, o]) => !op(report, m, o)?.ok);
  const reasons = blocked.length
    ? blocked.flatMap(([m, o]) => op(report, m, o)?.notes ?? [`${m}.${o}`])
    : explainMissing ? missingOps.flatMap(([m, o]) => op(report, m, o)?.notes.slice(-1) ?? []) : [];
  const link = report.modules.find((m) => m.id === module)?.dashboardLink;
  return { available: blocked.length === 0, missing: [...new Set(missingOps.map(([, , l]) => l))], reasons: [...new Set(reasons)], link, has };
}

/** Top-of-page notice: read-only (some actions missing) or unavailable, with the reason and the dashboard link. */
export function ModuleNotice({ instanceId, module, title, required, optional, explainMissing = false }: {
  instanceId: string | undefined; module: ModuleId; title: string; required: OpRef[]; optional: OptionalOp[]; explainMissing?: boolean;
}) {
  const a = useModuleAvailability(instanceId, module, required, optional, explainMissing);
  if (a.available && a.missing.length === 0) return null;
  return (
    <div className={a.available ? 'rounded-xl border border-warn/40 bg-warn-soft/40 p-4 text-sm' : 'rounded-xl border border-bad/30 bg-bad-soft/50 p-4 text-sm'}>
      <div className="flex items-center gap-2 font-medium">
        <Mark state={a.available ? 'readonly' : 'unavailable'} />
        {a.available ? `Indisponible sur cette instance : ${a.missing.join(', ').toLowerCase()}` : `${title} est indisponible sur cette instance`}
      </div>
      {a.reasons.length > 0 && <ul className="mt-2 space-y-1 text-ink-soft">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {a.link && (
        <a href={a.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-accent-ink hover:text-ink">
          Ouvrir le dashboard officiel
          <ArrowUpRight className="size-4" strokeWidth={1.5} />
        </a>
      )}
    </div>
  );
}
