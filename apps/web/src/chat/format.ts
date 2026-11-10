import type { Effort, RunStat } from '../api';
import type { Entry } from './events';

/** Reasoning effort values of Hermes (`model_options.reasoning_effort`) and their labels. */
export const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: 'none', label: 'Aucun', hint: 'Pas de réflexion avant de répondre' },
  { value: 'minimal', label: 'Minimal', hint: 'Réflexion très courte' },
  { value: 'low', label: 'Bas', hint: 'Rapide, pour les tâches simples' },
  { value: 'medium', label: 'Moyen', hint: 'Équilibre entre vitesse et soin' },
  { value: 'high', label: 'Élevé', hint: 'Plus de réflexion, plus long' },
  { value: 'xhigh', label: 'Très élevé', hint: 'Pour les problèmes difficiles' },
  { value: 'max', label: 'Max', hint: 'Le plus long sur la plupart des modèles' },
  { value: 'ultra', label: 'Ultra', hint: 'Seulement sur certains modèles' },
];

export const effortLabel = (e: string | null | undefined): string =>
  e ? EFFORTS.find((x) => x.value === e)?.label ?? e : 'Auto';

const nf = (digits: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Hermes model id without its provider prefix: anthropic/claude-opus-4.6 → claude-opus-4.6. */
export function shortModel(id: string): string {
  const i = id.lastIndexOf('/');
  return i >= 0 && i < id.length - 1 ? id.slice(i + 1) : id;
}

/** 12 s, 1 min 8 s, 1 h 2 min. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const r = s % 60;
    return r ? `${Math.floor(s / 60)} min ${r} s` : `${s / 60} min`;
  }
  const m = Math.floor((s % 3600) / 60);
  return m ? `${Math.floor(s / 3600)} h ${m} min` : `${Math.floor(s / 3600)} h`;
}

/** 999, 5,2 k, 622 k, 1,3 M (French separators). */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${nf(1).format(Math.round(n / 100) / 10)} k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} k`;
  return `${nf(1).format(Math.round(n / 100_000) / 10)} M`;
}

/** 0,39 $ ; 4 decimals below one cent. */
export function formatCost(usd: number): string {
  return `${nf(usd < 0.01 ? 4 : 2).format(usd)} $`;
}

/** Share of the input read from the cache (Hermes counts the input cache included); null when unknown. */
export function cacheShare(r: Pick<RunStat, 'inputTokens' | 'cacheReadTokens'>): number | null {
  if (!r.inputTokens || r.cacheReadTokens === null) return null;
  return Math.min(1, r.cacheReadTokens / r.inputTokens);
}

export const formatShare = (x: number): string => `${nf(1).format(Math.round(x * 1000) / 10)} %`;

/**
 * Where each run line goes: key of the history entry after which it is shown (several lines may share one).
 * Anchor = last history entry written before the run ended (2 s margin: Hermes writes its last message just
 * before the end), and before the next run started; a run older than every loaded entry is not shown, a newer
 * one goes after the last entry.
 * Each line is placed on its own, so a reply Hermes did not keep does not shift the next ones.
 */
export function placeRunStats(history: Entry[], runs: RunStat[]): Map<string, RunStat[]> {
  const anchors = history.filter((e) => e.ts !== null) as (Entry & { ts: number })[];
  const out = new Map<string, RunStat[]>();
  const sorted = [...runs].sort((a, b) => a.startedAt - b.startedAt);
  sorted.forEach((r, i) => {
    // never past the start of the next run (its message is written after it starts)
    const next = sorted[i + 1];
    const end = Math.min((r.endedAt ?? r.startedAt) / 1000 + 2, next ? next.startedAt / 1000 - 0.001 : Infinity);
    let anchor: string | null = null;
    for (const e of anchors) if (e.ts <= end) anchor = e.key;
    if (!anchor) return;
    out.set(anchor, [...(out.get(anchor) ?? []), r]);
  });
  return out;
}
