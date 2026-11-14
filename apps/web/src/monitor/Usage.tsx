import { useQuery } from '@tanstack/react-query';
import { api, type PublicUsage } from '../api';
import { Chips, ErrorText, Panel } from '../components/ui';
import { DailyBars } from './DailyBars';
import { formatTokens, formatUsd } from './format';
import { plural, t } from '../i18n';

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

const SOURCE_LABEL: Record<string, string> = { api_server: t('API (Intendia, applis)'), cli: t('Terminal'), cron: t('Crons'), telegram: 'Telegram', discord: 'Discord', slack: 'Slack', kanban: 'Kanban' };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[13px] text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-[20px] font-semibold leading-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function Ranked({ title, rows, empty }: { title: string; rows: { name: string; count: number | null; percentage: number | null }[]; empty: string }) {
  return (
    <Panel title={title} bodyClassName="border-t border-line/70">
      {rows.length === 0 ? <p className="px-4 py-6 text-sm text-ink-faint">{empty}</p> : (
        <ul className="divide-y divide-line/70 text-sm">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.name}</span>
              <span className="font-mono text-[13px] text-ink-soft">{r.count ?? '—'}</span>
              <span className="w-14 text-right font-mono text-xs text-ink-faint">{r.percentage === null ? '' : t('{n} %', { n: Math.round(r.percentage) })}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function UsageBody({ u }: { u: PublicUsage }) {
  const tot = u.totals;
  const active = u.daily.filter((d) => (d.sessions ?? 0) > 0 || (d.apiCalls ?? 0) > 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t('Coût estimé (USD)')} value={formatUsd(tot.estimatedCost)} hint={tot.actualCost ? t('facturé : {v}', { v: formatUsd(tot.actualCost) }) : undefined} />
        <Tile label={t('Sessions')} value={tot.sessions === null ? '—' : String(tot.sessions)} hint={tot.apiCalls === null ? undefined : plural(tot.apiCalls, '{n} appel au modèle', '{n} appels au modèle')} />
        <Tile label={t('Jetons envoyés')} value={formatTokens(tot.input)} hint={tot.cacheRead ? t('dont cache : {v}', { v: formatTokens(tot.cacheRead) }) : undefined} />
        <Tile label={t('Jetons reçus')} value={formatTokens(tot.output)} hint={tot.reasoning ? t('dont raisonnement : {v}', { v: formatTokens(tot.reasoning) }) : undefined} />
      </div>
      <Panel title={t('Coût estimé par jour')}>
        {active.length === 0 ? <p className="py-6 text-center text-sm text-ink-faint">{t('Aucune activité sur la période')}</p> : <DailyBars daily={u.daily} days={u.days} />}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-soft hover:text-ink">{t('Voir en tableau')}</summary>
          <table className="mt-2 w-full text-[13px]">
            <thead className="text-left text-ink-faint"><tr><th className="py-1 font-normal">{t('Jour')}</th><th className="font-normal">{t('Coût estimé')}</th><th className="font-normal">{t('Sessions')}</th><th className="font-normal">{t('Appels')}</th></tr></thead>
            <tbody className="divide-y divide-line/70 font-mono">
              {active.map((d) => <tr key={d.day}><td className="py-1">{d.day}</td><td>{formatUsd(d.estimatedCost)}</td><td>{d.sessions ?? '—'}</td><td>{d.apiCalls ?? '—'}</td></tr>)}
            </tbody>
          </table>
        </details>
        <p className="mt-3 text-xs text-ink-faint">
          {t('Coûts parfois écrits en différé, 0 si le prix du modèle est inconnu. Une session compte entière le jour de son début. Toutes les sources sont comptées (terminal, crons, messageries), pas seulement Intendia.')}
        </p>
      </Panel>
      <Panel title={t('Par modèle')} bodyClassName="border-t border-line/70 overflow-x-auto">
        {u.byModel.length === 0 ? <p className="px-4 py-6 text-sm text-ink-faint">{t('Aucun modèle utilisé')}</p> : (
          <table className="w-full text-[13px]">
            <thead className="text-left text-ink-faint"><tr><th className="px-4 py-2 font-normal">{t('Modèle')}</th><th className="font-normal">{t('Sessions')}</th><th className="font-normal">{t('Appels')}</th><th className="font-normal">{t('Jetons envoyés / reçus')}</th><th className="pr-4 text-right font-normal">{t('Coût estimé')}</th></tr></thead>
            <tbody className="divide-y divide-line/70">
              {u.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="px-4 py-2 font-mono">{m.model}</td>
                  <td className="font-mono">{m.sessions ?? '—'}</td>
                  <td className="font-mono">{m.apiCalls ?? '—'}</td>
                  <td className="font-mono">{formatTokens(m.input)} / {formatTokens(m.output)}</td>
                  <td className="pr-4 text-right font-mono">{formatUsd(m.estimatedCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="grid gap-5 lg:grid-cols-3">
        <Ranked title={t('Outils les plus utilisés')} rows={u.tools} empty={t('Aucun outil utilisé')} />
        <Ranked title={t('Skills les plus utilisés')} rows={u.skills} empty={t('Aucun skill utilisé')} />
        <Panel title={t('Sessions par source')} bodyClassName="border-t border-line/70">
          {u.sources === null ? <p className="px-4 py-6 text-sm text-ink-faint">{t('Hermes n’a pas donné cette information')}</p> : (
            <ul className="divide-y divide-line/70 text-sm">
              {Object.entries(u.sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center gap-3 px-4 py-2"><span className="flex-1">{SOURCE_LABEL[k] ?? k}</span><span className="font-mono text-[13px] text-ink-soft">{v}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function Usage({ inst, profile, days, onDays }: { inst: string; profile: string; days: Period; onDays: (d: Period) => void }) {
  const q = useQuery({ queryKey: ['monitor', inst, profile, 'usage', days], queryFn: () => api.monitorUsage(inst, profile, days), staleTime: 30_000 });
  return (
    <div className="space-y-4">
      <Chips label={t('Période')} value={String(days) as `${Period}`} onChange={(d) => onDays(Number(d) as Period)}
        items={PERIODS.map((p) => ({ key: String(p) as `${Period}`, label: t('{n} jours', { n: p }) }))} />
      <ErrorText error={q.error} />
      {q.isPending && <p className="text-sm text-ink-faint">{t('Chargement…')}</p>}
      {q.data && <UsageBody u={q.data} />}
    </div>
  );
}
