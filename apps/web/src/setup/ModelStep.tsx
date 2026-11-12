import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, type ModelInput } from '../api';
import { useModuleAvailability } from '../components/ModuleNotice';
import { Button, ErrorText } from '../components/ui';
import { configKey, errorCode, errorData, SELECT } from '../config/common';
import { MainModel } from '../config/Models';
import { StepFrame, useStepInstance } from './Frame';

const PROFILE = 'default';

/**
 * Step 2: the main model. Hermes proposes one for a connected provider (`recommended-default`); « Choisir un autre » is
 * the main model selector of Configuration › Modèles. Reading the providers (like every model selector) may let Hermes
 * write the discovered models of custom endpoints into its file.
 */
export function ModelStep() {
  const { inst } = useStepInstance();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const a = useModuleAvailability(inst ?? undefined, 'config', [], []);
  const models = useQuery({ queryKey: configKey(inst ?? '', PROFILE, 'models'), queryFn: () => api.configModels(inst!, PROFILE), enabled: Boolean(inst) });
  const authed = (models.data?.providers ?? []).filter((p) => p.authenticated);
  const [provider, setProvider] = useState('');
  useEffect(() => { if (!provider && authed[0]) setProvider(authed[0].slug); }, [authed, provider]);
  const canRecommend = a.has('config', 'recommendedModel');
  const rec = useQuery({
    queryKey: ['recommended-model', inst, provider], queryFn: () => api.recommendedModel(inst!, provider, PROFILE),
    enabled: Boolean(inst && provider && canRecommend), retry: false,
  });
  const [other, setOther] = useState(false);
  const [confirm, setConfirm] = useState<{ input: ModelInput; message: string } | null>(null);
  const done = () => void navigate({ to: '/installation/workspace', search: inst ? { inst } : {} });
  const set = useMutation({
    mutationFn: (input: ModelInput) => api.setModel(inst!, PROFILE, input),
    onSuccess: async () => {
      setConfirm(null);
      await qc.invalidateQueries({ queryKey: ['config', inst, PROFILE] });
      done();
    },
    onError: async (err, input) => {
      if (errorCode(err) === 'confirm_required') setConfirm({ input, message: String(errorData(err).message ?? 'Confirmer ?') });
      if (errorCode(err) === 'config_changed') { setConfirm(null); await models.refetch(); }
    },
  });
  const m = models.data;
  const writable = Boolean(m && m.version !== null && a.has('config', 'setModel'));
  const use = (p: string, model: string) => m && set.mutate({ scope: 'main', provider: p, model, version: m.version! });
  const error = set.error && errorCode(set.error) !== 'confirm_required' ? set.error : null;

  return (
    <StepFrame step={1} title="Choisir le modèle principal" next={m?.main.model ? done : null}
      intro="Le modèle qui répond dans les sessions de l’agent. Vous pourrez en changer à tout moment dans Configuration › Modèles.">
      {!inst ? <p className="text-sm text-ink-soft">Aucune instance : ajoutez-en une d’abord.</p>
        : models.isPending ? <p className="text-sm text-ink-soft">Lecture des fournisseurs…</p>
          : !m ? <ErrorText error={models.error} />
            : (
              <div className="space-y-5">
                {m.main.model && <p className="text-sm" data-current-model>Modèle actuel : <span className="font-mono text-[12.5px]">{m.main.model}</span> ({m.main.provider})</p>}
                {!writable && <p className="text-sm text-ink-soft">Changement de modèle indisponible sur cette instance.</p>}
                {authed.length === 0 ? (
                  <p className="text-sm text-ink-soft" data-no-provider>Aucun fournisseur n’est connecté : revenez à l’étape précédente, ou passez celle-ci.</p>
                ) : (
                  <div className="card space-y-4 p-5 md:p-6">
                    {authed.length > 1 && (
                      <label className="block max-w-xs">
                        <span className="mb-1.5 block text-[13px] font-medium">Fournisseur</span>
                        <select className={`${SELECT} w-full`} value={provider} onChange={(e) => { setProvider(e.target.value); setConfirm(null); }} aria-label="Fournisseur connecté">
                          {authed.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                        </select>
                      </label>
                    )}
                    {!canRecommend ? null : rec.isPending ? <p className="text-sm text-ink-faint">Hermes cherche un modèle…</p> : rec.data?.model ? (
                      <div className="flex flex-wrap items-center gap-3" data-recommended={rec.data.model}>
                        <p className="min-w-0 flex-1 text-sm">Hermes propose <span className="font-mono text-[12.5px]">{rec.data.model}</span></p>
                        <Button variant="primary" disabled={!writable || set.isPending} onClick={() => use(provider, rec.data!.model!)}>Utiliser ce modèle</Button>
                      </div>
                    ) : <p className="text-sm text-ink-soft">Hermes n’a pas de modèle à proposer pour ce fournisseur : choisissez-en un.</p>}
                    {confirm && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn">
                        <span>{confirm.message}</span>
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={() => setConfirm(null)}>Annuler</Button>
                          <Button variant="primary" onClick={() => set.mutate({ ...confirm.input, confirm: true })}>Confirmer</Button>
                        </div>
                      </div>
                    )}
                    <ErrorText error={error ?? rec.error} />
                    {other || !canRecommend || (rec.isSuccess && !rec.data.model) ? (
                      <MainModel data={{ ...m, main: { ...m.main, provider: m.main.provider && m.main.provider !== 'auto' ? m.main.provider : provider } }}
                        disabled={!writable || set.isPending} onSave={use} />
                    ) : <Button variant="ghost" onClick={() => setOther(true)}>Choisir un autre modèle</Button>}
                  </div>
                )}
              </div>
            )}
    </StepFrame>
  );
}
