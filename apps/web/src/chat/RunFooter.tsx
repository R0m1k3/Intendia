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
  if (r.costRuns > 1) {
    const prev = r.costRuns - 1 === 1 ? 'la précédente, envoyée' : `les ${r.costRuns - 1} précédentes, envoyées`;
    parts.push(`Coût : cette réponse et ${prev} avant qu'Hermes ait compté leur coût`);
  }
  parts.push(`Demandé : ${r.requestedModel ?? 'Auto'}, effort ${effortLabel(r.requestedEffort)}`);
  if (fallback(r)) parts.push(`Servi par un modèle de secours : ${r.servedModel}`);
  if (tokensPerSecond(r) !== null) parts.push('Débit : moyenne sur tout le run, outils compris');
  return parts.join('\n');
}

/** Output tokens over the whole run (tools included), when it lasted more than a second. */
export function tokensPerSecond(r: RunStat): number | null {
  if (r.outputTokens === null || r.endedAt === null || r.status === 'interrupted' || r.status === 'unknown') return null;
  const ms = r.endedAt - r.startedAt;
  return ms > 1000 && r.outputTokens > 0 ? Math.round(r.outputTokens / (ms / 1000)) : null;
}

/** Served by another model than the one asked (provider fallback); Auto asks nothing, so never. */
export function fallback(r: RunStat): boolean {
  return Boolean(r.requestedModel && r.servedModel && shortModel(r.requestedModel) !== shortModel(r.servedModel));
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
  if (r.servedModel) items.push(shortModel(r.servedModel) + (fallback(r) ? ' (secours)' : ''));
  else if (r.requestedModel) items.push(`${shortModel(r.requestedModel)} (demandé)`);
  // Hermes dates interrupted / forgotten runs when it notices them: no meaningful duration
  if (r.endedAt !== null && r.status !== 'interrupted' && r.status !== 'unknown') items.push(formatDuration(r.endedAt - r.startedAt));
  // a cost covering previous replies too (sent before their cost was known) says so
  if (r.costUsd) items.push(r.costRuns > 1 ? `${formatCost(r.costUsd)} (${r.costRuns} réponses)` : formatCost(r.costUsd));
  if (r.inputTokens !== null && r.outputTokens !== null) items.push(`${formatTokens(r.inputTokens)} → ${formatTokens(r.outputTokens)}`);
  const rate = tokensPerSecond(r);
  if (rate !== null) items.push(`≈ ${rate} jetons/s`);
  const share = cacheShare(r);
  if (share !== null) items.push(`Cache ${formatShare(share)}`);
  const st = STATUS[r.status];
  if (!items.length && !st) return null;
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-xs text-ink-faint" title={detail(r)} data-run-footer={r.runId}>
      {st && <span className="flex h-4 shrink-0 items-center" aria-label={st.label}>{st.icon}</span>}
      <span className="min-w-0 font-mono tabular-nums">{items.join(' · ')}</span>
    </p>
  );
}
