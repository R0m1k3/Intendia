import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { api, type CompatReport } from '../api';
import { Mark } from './ui';

const REQUIRED: [module: string, op: string][] = [['chat', 'createRun'], ['chat', 'runStatus'], ['chat', 'runEvents'], ['sessions', 'messages']];
const OPTIONAL: [module: string, op: string, label: string][] = [['chat', 'stopRun', 'Arrêter un run'], ['chat', 'approval', 'Répondre aux approbations']];

function op(report: CompatReport, module: string, name: string) {
  return report.modules.find((m) => m.id === module)?.ops[name];
}

/**
 * Chat availability from the operations phase 2 uses, not from the module state:
 * a missing `steer` must not warn, a missing `createRun` must block.
 */
export function useChatAvailability(instanceId: string | undefined) {
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const report = compat.data?.reports.find((r) => r.instanceId === instanceId);
  if (!report) return { available: true, missing: [] as string[], reasons: [] as string[], link: undefined as string | undefined };
  const blocked = REQUIRED.filter(([m, o]) => !op(report, m, o)?.ok);
  const missing = OPTIONAL.filter(([m, o]) => !op(report, m, o)?.ok).map(([, , l]) => l);
  const reasons = blocked.flatMap(([m, o]) => op(report, m, o)?.notes ?? [`${m}.${o}`]);
  const link = report.modules.find((m) => m.id === 'chat')?.dashboardLink;
  return { available: blocked.length === 0, missing, reasons, link };
}

export function ChatNotice({ instanceId }: { instanceId: string | undefined }) {
  const a = useChatAvailability(instanceId);
  if (a.available && a.missing.length === 0) return null;
  return (
    <div className={a.available ? 'rounded-xl border border-warn/40 bg-warn-soft/40 p-4 text-sm' : 'rounded-xl border border-bad/30 bg-bad-soft/50 p-4 text-sm'}>
      <div className="flex items-center gap-2 font-medium">
        <Mark state={a.available ? 'readonly' : 'unavailable'} />
        {a.available ? `Indisponible sur cette instance : ${a.missing.join(', ').toLowerCase()}` : 'Le chat est indisponible sur cette instance'}
      </div>
      {a.reasons.length > 0 && <ul className="mt-2 space-y-1 text-ink-soft">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {a.link && (
        <a href={a.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-accent hover:text-accent-strong">
          Ouvrir le dashboard officiel
          <ArrowUpRight className="size-4" strokeWidth={1.5} />
        </a>
      )}
    </div>
  );
}
