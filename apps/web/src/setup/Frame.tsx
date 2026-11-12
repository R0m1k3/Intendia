import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api';
import { Button, Wordmark } from '../components/ui';
import { setTab, useCurrentInstance } from '../instance/current';

export interface StepSearch { inst?: string }
const LABELS = ['Fournisseur', 'Modèle', 'Workspace'];

/** Instance of the steps: the one just created (`?inst=`), else the current one; profile `default`. */
export function useStepInstance(): { inst: string | null; label: string | null } {
  const search = useSearch({ strict: false }) as StepSearch;
  const { id, instances } = useCurrentInstance();
  const list = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const inst = search.inst && (list.data?.instances ?? []).some((i) => i.id === search.inst) ? search.inst : id;
  return { inst, label: instances.find((i) => i.id === inst)?.label ?? null };
}

/** Full page like /installation: the step, its title, « Passer » always there. */
export function StepFrame({ step, title, intro, children, next, nextLabel = 'Continuer', nextDisabled }: {
  step: 0 | 1 | 2; title: string; intro: ReactNode; children: ReactNode;
  /** null: no « Continuer » button (the step goes on by itself) */
  next?: (() => void) | null; nextLabel?: string; nextDisabled?: boolean;
}) {
  const navigate = useNavigate();
  const { inst } = useStepInstance();
  const skip = () => {
    if (step === 2) finishSetup(navigate, inst);
    else void navigate({ to: step === 0 ? '/installation/modele' : '/installation/workspace', search: inst ? { inst } : {} });
  };
  return (
    <div className="min-h-full bg-sheet"><div className="enter mx-auto max-w-3xl p-5 md:p-10" data-setup-step={step}>
      <div className="mb-10"><Wordmark size="lg" /></div>
      <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint" aria-label="Étapes">
        {LABELS.map((l, i) => (
          <li key={l} aria-current={i === step ? 'step' : undefined} className={i === step ? 'font-medium text-ink' : undefined}>{i + 1}. {l}</li>
        ))}
      </ol>
      <h1 className="text-[26px] font-semibold leading-tight">{title}</h1>
      <div className="mt-2 max-w-xl text-sm text-ink-soft">{intro}</div>
      <div className="mt-8">{children}</div>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {next !== null && <Button variant="primary" disabled={nextDisabled} onClick={next ?? skip}>{nextLabel}</Button>}
        <Button variant="ghost" onClick={skip}>{step < 2 ? 'Passer cette étape' : 'Terminer plus tard'}</Button>
      </div>
    </div></div>
  );
}

/** End of the steps: the instance just set up becomes the current one, then the home page (its workspaces). */
export function finishSetup(navigate: ReturnType<typeof useNavigate>, inst: string | null): void {
  if (inst) setTab(inst);
  void navigate({ to: '/' });
}
