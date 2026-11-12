import { describe, expect, it } from 'vitest';
import { costLine, goalLine, parseRelaunch, REASON_LABELS } from './goal';

describe('goal labels', () => {
  it('says the state, with the reason of a pause and its detail', () => {
    expect(goalLine({ status: 'active', reason: null, reasonDetail: null })).toBe('En cours');
    expect(goalLine({ status: 'done', reason: null, reasonDetail: null })).toBe('Objectif atteint');
    expect(goalLine({ status: 'paused', reason: 'blocked', reasonDetail: 'il manque la clé' })).toBe('En pause : bloqué (il manque la clé)');
    for (const r of Object.keys(REASON_LABELS) as (keyof typeof REASON_LABELS)[]) {
      expect(goalLine({ status: 'paused', reason: r, reasonDetail: null })).toBe(`En pause : ${REASON_LABELS[r]}`);
    }
  });

  it('shows the cost against the budget', () => {
    const spent = { usd: 0.0246, pending: false, priceUnknown: false, unpriced: 0 };
    expect(costLine({ budgetUsd: 1, spent })).toMatch(/^0,0246 \$ \/ 1,00 \$$/);
    expect(costLine({ budgetUsd: null, spent: { ...spent, usd: 0.5 } })).toMatch(/^0,50 \$ \(sans budget\)$/);
  });

  it('recognizes the relaunch messages only', () => {
    expect(parseRelaunch('[Intendia] Relance automatique 2/5 : continue vers l’objectif.')).toEqual({ n: 2, max: 5 });
    expect(parseRelaunch('Relance automatique 2/5')).toBeNull();
    expect(parseRelaunch('Bonjour')).toBeNull();
  });
});
