// Persistent goal of a session (option 7): labels of its state and pause reasons, and the relaunch messages
// Intendia's server sends (« [Intendia] Relance automatique 2/5 : … »), shown as a quiet line in the thread.
import { locale, t } from '../i18n';
import type { GoalReason, SessionGoal } from '../api';

export const REASON_LABELS: Record<GoalReason, string> = {
  user: t('vous avez écrit'),
  button: t('mis en pause'),
  click: t('en attente de votre clic'),
  blocked: t('bloqué'),
  failed: t('le run a échoué'),
  stopped: t('run arrêté'),
  lost: t('run introuvable chez Hermes'),
  limit: t('plafond de relances atteint'),
  budget: t('budget atteint'),
  start_failed: t('relance impossible'),
  gone: t('session supprimée'),
  cost_unknown: t('coût d’un tour inconnu : budget incomplet'),
  key_conflict: t('Relance déjà reçue par Hermes avec un autre contenu : vérifiez la conversation, puis reprenez'),
};

/** The state line of the goal bar, e.g. « En pause : bloqué (il manque la clé) ». */
export function goalLine(g: Pick<SessionGoal, 'status' | 'reason' | 'reasonDetail'>): string {
  if (g.status === 'done') return t('Objectif atteint');
  if (g.status === 'active') return t('En cours');
  const why = g.reason ? REASON_LABELS[g.reason] : t('en pause');
  // the label says it all (the detail is the server's message for the same refusal)
  return g.reasonDetail && g.reason !== 'key_conflict' ? t('En pause : {why} ({detail})', { why, detail: g.reasonDetail }) : t('En pause : {why}', { why });
}

const usd = (n: number) => t('{n} $', { n: n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: n < 0.1 ? 4 : 2 }) });

/** « 0,12 $ / 1,00 $ », « 0,12 $ (sans budget) ». */
export function costLine(g: Pick<SessionGoal, 'budgetUsd' | 'spent'>): string {
  const spent = usd(g.spent.usd);
  return g.budgetUsd === null ? t('{spent} (sans budget)', { spent }) : `${spent} / ${usd(g.budgetUsd)}`;
}

const RELAUNCH_RE = /^\s*\[Intendia\] Relance automatique (\d+)\/(\d+) :/;

const WAKE_RE = /^\s*\[Intendia\] Reprise automatique :/;

/** The message Intendia's server sends when background sub-agents delivered (server: chat/wake.ts). */
export const isWake = (text: string): boolean => WAKE_RE.test(text);
/** The wake sent past the longest wait, nothing delivered (server: waitTextExpired). */
export const isExpiredWake = (text: string): boolean => isWake(text) && /n’ont rien livré après \d+ min/.test(text);

/** A relaunch message of Intendia; null = an ordinary message. */
export function parseRelaunch(text: string): { n: number; max: number } | null {
  const m = RELAUNCH_RE.exec(text);
  return m ? { n: Number(m[1]), max: Number(m[2]) } : null;
}
