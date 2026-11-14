import { useNavigate } from '@tanstack/react-router';
import { NewWorkspace } from '../components/NewWorkspace';
import { finishSetup, StepFrame, useStepInstance } from './Frame';
import { t } from '../i18n';

/** Step 3: a first workspace (the usual form), then the home page. */
export function WorkspaceStep() {
  const { inst } = useStepInstance();
  const navigate = useNavigate();
  return (
    <StepFrame step={2} title={t('Créer un premier workspace')} next={null}
      intro={t('Un dossier partagé avec l’agent, ses consignes et ses sessions de travail.')}>
      {!inst ? <p className="text-sm text-ink-soft">{t('Aucune instance : ajoutez-en une d’abord.')}</p> : (
        <div className="card p-5 md:p-6">
          <NewWorkspace instanceId={inst} onCreated={() => finishSetup(navigate, inst)} />
        </div>
      )}
    </StepFrame>
  );
}
