// Set or edit the goal of a session (option 7): text, relaunch cap, budget, auto or after a click.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GoalSettings } from '../api';
import { Button, ErrorText, Input } from '../components/ui';
import { locale, t } from '../i18n';

export function GoalDialog({ initial, editing, autoApprove, onSubmit, onClose }: {
  initial: Partial<GoalSettings>;
  /** true = Modifier (PATCH): no first turn */
  editing: boolean;
  /** « Sans confirmation » is on: a budget is required */
  autoApprove: boolean;
  onSubmit: (g: GoalSettings) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial.text ?? '');
  const [max, setMax] = useState(String(initial.maxRelaunches ?? 5));
  const [budget, setBudget] = useState(initial.budgetUsd === null ? '' : String(initial.budgetUsd ?? 1).replace('.', locale() === 'fr-FR' ? ',' : '.'));
  const [mode, setMode] = useState<'auto' | 'click'>(initial.mode ?? 'auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    area.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); root?.removeAttribute('inert'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxN = Number(max);
  const budgetN = budget.trim() === '' ? null : Number(budget.trim().replace(',', '.'));
  const why = !text.trim() ? t('Écrivez l’objectif')
    : !Number.isInteger(maxN) || maxN < 1 || maxN > 50 ? t('Relances max : de 1 à 50')
      : budgetN !== null && (!Number.isFinite(budgetN) || budgetN < 0.01 || budgetN > 100) ? t('Budget : de 0,01 à 100 $, ou vide')
        : budgetN === null && autoApprove ? t('Avec « Sans confirmation », un budget est obligatoire') : null;

  const submit = async () => {
    if (why || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ text: text.trim(), maxRelaunches: maxN, budgetUsd: budgetN, mode });
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/25 px-3 pt-[12vh]" onMouseDown={onClose}>
      <form
        role="dialog" aria-modal="true" aria-label={editing ? t('Modifier l’objectif') : t('Fixer un objectif')} data-goal-dialog
        onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}
        className="enter w-full max-w-[480px] rounded-xl border border-line bg-sheet p-5 shadow-[var(--shadow-card)]"
      >
        <h2 className="text-[15px] font-semibold">{editing ? t('Modifier l’objectif') : t('Fixer un objectif')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          {t('Après chaque tour, Intendia relance l’agent jusqu’à ce qu’il écrive « OBJECTIF ATTEINT », même onglet fermé. Votre propre message met l’objectif en pause.')}
        </p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium">{t('Objectif')}</span>
          <textarea
            ref={area} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} name="goal-text"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}
            placeholder={t('Ex. : tous les tests du projet passent')}
            className="w-full resize-y rounded-lg border border-line bg-sheet px-3 py-2 text-sm outline-none focus:border-ink"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">{t('Relances max')}</span>
            <Input name="goal-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Budget ($)</span>
            <Input name="goal-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('aucun')} />
          </label>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">
          {t('Le budget est contrôlé entre les tours, avec un tour de retard possible (Hermes compte le coût après coup).')}
        </p>
        <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">{t('Relance')}</legend>
          <label className="flex items-center gap-2"><input type="radio" name="goal-mode" checked={mode === 'auto'} onChange={() => setMode('auto')} className="accent-accent" />{t('Relancer seul')}</label>
          <label className="flex items-center gap-2"><input type="radio" name="goal-mode" checked={mode === 'click'} onChange={() => setMode('click')} className="accent-accent" />{t('Après mon clic')}</label>
        </fieldset>
        {autoApprove && (
          <p className="mt-3 rounded-lg bg-raised px-3 py-2 text-[12.5px] leading-snug text-ink-soft" data-goal-warning>
            {t('« Sans confirmation » est activé : les actions des relances seront approuvées sans vous. Un budget est obligatoire.')}
          </p>
        )}
        <div className="mt-3 empty:hidden"><ErrorText error={error} /></div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {why && <span className="mr-auto text-[12px] text-ink-faint">{why}</span>}
          <Button type="button" variant="ghost" onClick={onClose}>{t('Annuler')}</Button>
          <Button type="submit" variant="primary" disabled={Boolean(why) || busy}>{editing ? t('Enregistrer') : t('Démarrer')}</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
