import { Check, Square, X } from 'lucide-react';
import type { RunStat } from '../api';
import { cacheShare, effortLabel, formatCost, formatDuration, formatShare, formatTokens, shortModel } from './format';

/** Hover text: token detail and what was asked for. */
function detail(r: RunStat): string {
  const parts: string[] = [];
  if (r.inputTokens !== null) {
    const fr = (n: number) => n.toLocaleString('fr-FR');
    parts.push(`Entrée : ${fr(r.inputTokens)} jetons dont ${fr(r.cacheReadTokens ?? 0)} lus du cache et ${fr(r.cacheWriteTokens ?? 0)} écrits dans le cache`);
    if (r.outputTokens !== null) parts.push(`Sortie : ${fr(r.outputTokens)} jetons`);
  } else {
    parts.push('Jetons non communiqués par Hermes pour ce run');
  }
  parts.push(`Demandé : ${r.requestedModel ?? 'Auto'}, effort ${effortLabel(r.requestedEffort)}`);
  return parts.join('\n');
}

const STATUS: Record<string, { icon: React.ReactNode; label: string }> = {
  completed: { icon: <Check className="size-3.5 text-ok" strokeWidth={2} />, label: 'Terminé' },
  failed: { icon: <X className="size-3.5 text-bad" strokeWidth={2} />, label: 'Échec' },
  cancelled: { icon: <Square className="size-3 fill-current" strokeWidth={1.5} />, label: 'Arrêté' },
  interrupted: { icon: <Square className="size-3 fill-current" strokeWidth={1.5} />, label: 'Interrompu' },
};

/** One line under a reply: status · model · duration · cost · input → output · cache share. */
export function RunFooter({ r }: { r: RunStat }) {
  const items: string[] = [];
  if (r.servedModel) items.push(shortModel(r.servedModel));
  else if (r.requestedModel) items.push(`${shortModel(r.requestedModel)} (demandé)`);
  // Hermes dates interrupted / forgotten runs when it notices them: no meaningful duration
  if (r.endedAt !== null && r.status !== 'interrupted' && r.status !== 'unknown') items.push(formatDuration(r.endedAt - r.startedAt));
  if (r.costUsd) items.push(formatCost(r.costUsd));
  if (r.inputTokens !== null && r.outputTokens !== null) items.push(`${formatTokens(r.inputTokens)} → ${formatTokens(r.outputTokens)}`);
  const share = cacheShare(r);
  if (share !== null) items.push(`Cache ${formatShare(share)}`);
  const st = STATUS[r.status];
  if (!items.length && !st) return null;
  return (
    <div className="mt-1.5 grid grid-cols-[44px_minmax(0,1fr)] gap-3 md:grid-cols-[56px_minmax(0,1fr)] md:gap-4" data-run-footer={r.runId}>
      <div />
      <p className="flex min-w-0 items-start gap-1.5 text-xs text-ink-faint" title={detail(r)}>
        {st && <span className="flex h-4 shrink-0 items-center" aria-label={st.label}>{st.icon}</span>}
        <span className="min-w-0 font-mono tabular-nums">{items.join(' · ')}</span>
      </p>
    </div>
  );
}
