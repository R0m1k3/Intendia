import type { SessionUsage } from '../api';
import { cx } from '../components/ui';
import { formatTokens } from './format';

const time = (ms: number) => new Date(ms).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Context used by the session: the gateway's figures when the dashboard WebSocket gives them, otherwise the page's
 * estimate (« ≈ ») over the model's context size when known. Plan quota after it, from the WebSocket only.
 */
export function ContextGauge({ usage, estimate }: { usage: SessionUsage | undefined; estimate: number }) {
  const exact = usage?.exact ?? null;
  const used = exact?.used ?? estimate;
  const max = exact?.max ?? usage?.max ?? null;
  if (!used && !max) return null;
  const share = max ? Math.min(1, used / max) : null;
  const quota = usage?.quota ?? null;
  const title = [
    exact ? 'Contexte occupé, compté par Hermes' : 'Contexte estimé par Intendia à partir du fil (sans le prompt système ni les outils)',
    max ? `Taille du contexte du modèle : ${max.toLocaleString('fr-FR')} jetons` : 'Taille du contexte du modèle inconnue pour ce choix de modèle',
    quota ? `${quota.label ?? 'Forfait'} : ${Math.round(quota.usedPercent)} % utilisés${quota.resetsAt ? `, remise à zéro ${time(quota.resetsAt)}` : ''}` : null,
  ].filter(Boolean).join('\n');
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 text-[11px] text-ink-faint" title={title} data-gauge={exact ? 'exact' : 'estimate'}>
      {share !== null && (
        <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-line" aria-hidden>
          <span className={cx('block h-full rounded-full', share > 0.8 ? 'bg-warn' : 'bg-ink-faint')} style={{ width: `${Math.max(2, share * 100)}%` }} />
        </span>
      )}
      <span className="truncate font-mono tabular-nums">
        {exact ? '' : '≈ '}{formatTokens(used)}{max ? ` / ${formatTokens(max)}` : ''}
        {quota && <span data-quota> · {quota.label ?? 'Forfait'} {Math.round(quota.usedPercent)} %</span>}
      </span>
    </div>
  );
}
