import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useModuleAvailability } from '../components/ModuleNotice';
import { ConfigProviders } from '../config/Providers';
import { StepFrame, useStepInstance } from './Frame';
import { t } from '../i18n';
import { T } from '../i18n/T';

const PROFILE = 'default';

/** Step 1: an account or an API key for the agent, the Configuration › Fournisseurs tab as it is. */
export function ProviderStep() {
  const { inst, label } = useStepInstance();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const a = useModuleAvailability(inst ?? undefined, 'config', [], []);
  const [restart, setRestart] = useState(false);
  return (
    <StepFrame step={0} title={t('Connecter un fournisseur d’IA')}
      intro={label
        ? <T k="L’agent de {label} a besoin d’un abonnement ou d’une clé d’API pour répondre. Les clés restent dans Hermes." vars={{ label: <span className="text-ink">{label}</span> }} />
        : t('L’agent a besoin d’un abonnement ou d’une clé d’API pour répondre. Les clés restent dans Hermes.')}
      next={() => void navigate({ to: '/installation/modele', search: inst ? { inst } : {} })}>
      {!inst ? <p className="text-sm text-ink-soft">{t('Aucune instance : ajoutez-en une d’abord.')}</p> : (
        <div className="card p-5 md:p-6">
          <ConfigProviders inst={inst} profile={PROFILE} can={(op) => a.has('config', op)}
            onSaved={(r) => { if (r) setRestart(true); void qc.invalidateQueries({ queryKey: ['config', inst, PROFILE] }); }} />
        </div>
      )}
      {restart && <p className="mt-3 text-sm text-warn">{t('Ce changement compte après un redémarrage de la passerelle (Configuration de l’instance).')}</p>}
    </StepFrame>
  );
}
