// Persistent goal of a session (option 7): labels of its state and pause reasons, and the relaunch messages
// Intendia's server sends (« [Intendia] Relance automatique 2/5 : … »), shown as a quiet line in the thread.
import type { GoalReason, SessionGoal } from '../api';

export const REASON_LABELS: Record<GoalReason, string> = {
  user: 'vous avez écrit',
  button: 'mis en pause',
  click: 'en attente de votre clic',
  blocked: 'bloqué',
  failed: 'le run a échoué',
  stopped: 'run arrêté',
  lost: 'run introuvable chez Hermes',
  limit: 'plafond de relances atteint',
  budget: 'budget atteint',
  start_failed: 'relance impossible',
  gone: 'session supprimée',
  cost_unknown: 'coût d’un tour inconnu : budget incomplet',
};

/** The state line of the goal bar, e.g. « En pause : bloqué (il manque la clé) ». */
export function goalLine(g: Pick<SessionGoal, 'status' | 'reason' | 'reasonDetail'>): string {
  if (g.status === 'done') return 'Objectif atteint';
  if (g.status === 'active') return 'En cours';
  const why = g.reason ? REASON_LABELS[g.reason] : 'en pause';
  return `En pause : ${why}${g.reasonDetail ? ` (${g.reasonDetail})` : ''}`;
}

const usd = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: n < 0.1 ? 4 : 2 })} $`;

/** « 0,12 $ / 1,00 $ », « 0,12 $ (sans budget) ». */
export function costLine(g: Pick<SessionGoal, 'budgetUsd' | 'spent'>): string {
  const spent = usd(g.spent.usd);
  return g.budgetUsd === null ? `${spent} (sans budget)` : `${spent} / ${usd(g.budgetUsd)}`;
}

const RELAUNCH_RE = /^\s*\[Intendia\] Relance automatique (\d+)\/(\d+) :/;

/** A relaunch message of Intendia; null = an ordinary message. */
export function parseRelaunch(text: string): { n: number; max: number } | null {
  const m = RELAUNCH_RE.exec(text);
  return m ? { n: Number(m[1]), max: Number(m[2]) } : null;
}
