import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api';
import { AgentAvatar, ColorChoice, useAgentLooks } from '../agents/look';
import { ask } from '../components/Dialog';
import { NewWorkspace } from '../components/NewWorkspace';
import { Button } from '../components/ui';
import { NewAgent } from '../pages/Agents';
import { finishSetup, StepFrame, useStepInstance } from './Frame';
import { t } from '../i18n';

/**
 * Step 3, « Votre premier agent » (OpenBot-like): Hermes already has its main agent; it gets a colour and a first
 * folder (the usual form), then the home page. Or another agent is created, and its card opens.
 */
export function WorkspaceStep() {
  const { inst } = useStepInstance();
  const navigate = useNavigate();
  const looks = useAgentLooks(inst);
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst!).then((r) => r.agents), enabled: Boolean(inst), retry: false });
  const main = agents.data?.find((a) => a.isDefault)?.name ?? 'default';
  const [creating, setCreating] = useState(false);
  return (
    <StepFrame step={2} title={t('Votre premier agent')} next={null}
      intro={t('Hermes a déjà un agent principal. Donnez-lui une couleur et un premier dossier : ses sessions y rangent leurs fichiers.')}>
      {!inst ? <p className="text-sm text-ink-soft">{t('Aucune instance : ajoutez-en une d’abord.')}</p> : (
        <div className="card p-5 md:p-6" data-first-agent>
          <div className="mb-5 flex items-center gap-3">
            <AgentAvatar name={main} color={looks.color(main)} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold leading-6">{main}</p>
              <p className="text-[12.5px] text-ink-soft">{t('L’agent principal de l’instance')}</p>
            </div>
          </div>
          <div className="mb-6"><ColorChoice value={looks.index(main)} onPick={(i) => void looks.set(main, i)} /></div>
          <NewWorkspace instanceId={inst} onCreated={() => finishSetup(navigate, inst)} />
          <div className="mt-5 border-t border-line/70 pt-4">
            <Button variant="ghost" onClick={() => setCreating(true)}>{t('Créer un autre agent…')}</Button>
          </div>
          {creating && (
            <NewAgent inst={inst} agents={agents.data ?? []} onClose={() => setCreating(false)}
              onCreated={(name, _source, modelError) => {
                setCreating(false);
                finishSetup(navigate, inst);
                void navigate({ to: '/i/$inst/agents/$name', params: { inst, name } });
                // Hermes made the agent but refused the model: say it, the card does not keep this error
                if (modelError) void ask({ title: t('Agent créé, modèle non appliqué'), message: t('Modèle non appliqué : {error}', { error: modelError }), confirmLabel: t('Compris') });
              }} />
          )}
        </div>
      )}
    </StepFrame>
  );
}
