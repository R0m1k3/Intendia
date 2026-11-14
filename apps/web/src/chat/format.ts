import { locale, t } from '../i18n';
import type { Effort, RunStat } from '../api';
import type { Entry } from './events';

/** Reasoning effort values of Hermes (`model_options.reasoning_effort`) and their labels. */
export const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: 'none', label: t('Aucun'), hint: t('Pas de réflexion avant de répondre') },
  { value: 'minimal', label: 'Minimal', hint: t('Réflexion très courte') },
  { value: 'low', label: t('Bas'), hint: t('Rapide, pour les tâches simples') },
  { value: 'medium', label: t('Moyen'), hint: t('Équilibre entre vitesse et soin') },
  { value: 'high', label: t('Élevé'), hint: t('Plus de réflexion, plus long') },
  { value: 'xhigh', label: t('Très élevé'), hint: t('Pour les problèmes difficiles') },
  { value: 'max', label: 'Max', hint: t('Le plus long sur la plupart des modèles') },
  { value: 'ultra', label: 'Ultra', hint: t('Seulement sur certains modèles') },
];

export const effortLabel = (e: string | null | undefined): string =>
  e ? EFFORTS.find((x) => x.value === e)?.label ?? e : 'Auto';

const nf = (digits: number) => new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

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
  return t('{n} $', { n: nf(usd < 0.01 ? 4 : 2).format(usd) });
}

/** Share of the input read from the cache (Hermes counts the input cache included); null when unknown. */
export function cacheShare(r: Pick<RunStat, 'inputTokens' | 'cacheReadTokens'>): number | null {
  if (!r.inputTokens || r.cacheReadTokens === null) return null;
  return Math.min(1, r.cacheReadTokens / r.inputTokens);
}

export const formatShare = (x: number): string => t('{n} %', { n: nf(1).format(Math.round(x * 1000) / 10) });

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

/** Re-read delay of a cost Hermes may still be writing. */
export const COST_POLL_MS = 5_000;
/** The server freezes a cost 30 s after the run's end; past this, the page stops asking (clock drift margin). */
const COST_POLL_LIMIT_MS = 45_000;

/** True while the last reply's cost may still change: the page re-reads it. */
export function costSettling(runs: RunStat[] | undefined, now = Date.now()): boolean {
  const last = runs?.[runs.length - 1];
  if (!last || last.costFinal || last.status === 'unknown' || last.endedAt === null) return false;
  return now - last.endedAt < COST_POLL_LIMIT_MS;
}

/**
 * Name shown above the agent's replies: the agent (Hermes profile) when it is not the default one, else the
 * instance's name; "Hermes" while neither is known.
 */
export function agentName(profile: string | null | undefined, instanceLabel: string | null | undefined): string {
  if (profile && profile !== 'default') return profile;
  return instanceLabel?.trim() || 'Hermes';
}
