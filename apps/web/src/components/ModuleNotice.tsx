import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { api, type ModuleId } from '../api';
import { availability, compatPoll, type OpRef, type OptionalOp } from './availability';
import { Mark } from './ui';
import { t } from '../i18n';

export type { OpRef, OptionalOp } from './availability';

export function useModuleAvailability(instanceId: string | undefined, module: ModuleId, required: OpRef[], optional: OptionalOp[], explainMissing = false) {
  const compat = useQuery({
    queryKey: ['compat'], queryFn: api.compat,
    refetchInterval: (q) => compatPoll(q.state.data?.reports.find((r) => r.instanceId === instanceId)),
  });
  const report = compat.data?.reports.find((r) => r.instanceId === instanceId);
  return availability(report, module, required, optional, explainMissing);
}

/** Top-of-page notice: read-only (some actions missing) or unavailable, with the reason and the dashboard link. */
export function ModuleNotice({ instanceId, module, title, required, optional, explainMissing = false }: {
  instanceId: string | undefined; module: ModuleId; title: string; required: OpRef[]; optional: OptionalOp[]; explainMissing?: boolean;
}) {
  const a = useModuleAvailability(instanceId, module, required, optional, explainMissing);
  const pendingLine = a.pending && (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-ink-soft first:mt-0" data-compat-pending>
      {a.checkError ? t('Vérification échouée : {error}', { error: a.checkError }) : t('Vérification de cette instance en cours')}
      <Link to="/etat" className="font-medium text-accent-ink hover:text-ink">{t('Page État')}</Link>
    </div>
  );
  const soft = a.available || a.onlyPending;
  if (soft && a.missing.length === 0) {
    return pendingLine ? <div className="rounded-[10px] bg-raised px-3.5 py-3 text-[13.5px]">{pendingLine}</div> : null;
  }
  return (
    <div className={soft ? 'rounded-[10px] bg-warn-soft px-3.5 py-3 text-[13.5px] text-warn' : 'rounded-[10px] bg-bad-soft px-3.5 py-3 text-[13.5px] text-bad'}>
      <div className="flex items-center gap-2 font-medium">
        <Mark state={soft ? 'readonly' : 'unavailable'} />
        {soft ? t('Indisponible sur cette instance : {list}', { list: a.missing.join(', ').toLowerCase() }) : t('{title} est indisponible sur cette instance', { title })}
      </div>
      {a.reasons.length > 0 && <ul className="mt-2 space-y-1 text-ink-soft">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {pendingLine}
      {a.link && (
        <a href={a.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-medium text-accent-ink hover:text-ink">
          {t('Ouvrir le dashboard officiel')}
          <ArrowUpRight className="size-4" strokeWidth={1.5} />
        </a>
      )}
    </div>
  );
}
