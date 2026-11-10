import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ConfigModels, type ModelInput } from '../api';
import { Button, ErrorText, Input, Panel, Section } from '../components/ui';
import { CHANGED_TEXT, configKey, errorCode, errorData, ICON, SELECT, useInvalidateConfig, type TabProps } from './common';

/** Main model and auxiliary tasks; the provider key is set in the Variables tab, never here. */
export function ConfigModelsTab({ inst, profile, can, onSaved, onKey }: TabProps & { onKey: (key: string) => void }) {
  const models = useQuery({ queryKey: configKey(inst, profile, 'models'), queryFn: () => api.configModels(inst, profile) });
  const invalidate = useInvalidateConfig(inst, profile);
  const [confirmFor, setConfirmFor] = useState<{ input: ModelInput; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (input: ModelInput) => api.setModel(inst, profile, input),
    onSuccess: async (res) => {
      setConfirmFor(null);
      setNotice(res.notice ?? null);
      await invalidate();
      onSaved(false);
    },
    onError: async (err, input) => {
      if (errorCode(err) === 'confirm_required') setConfirmFor({ input, message: String(errorData(err).message ?? 'Confirmer ?') });
      // the file changed elsewhere: reread it so the next attempt carries the new version
      if (errorCode(err) === 'config_changed') { setConfirmFor(null); await models.refetch(); }
    },
  });

  // reading the options may write discovered models into the file: other tabs must reread
  const invalidateOthers = useInvalidateOthers(inst, profile);
  useEffect(() => { if (models.dataUpdatedAt) void invalidateOthers(); }, [models.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (models.isPending) return <p className="text-sm text-ink-soft">Lecture des modèles…</p>;
  if (models.isError || !models.data) return <ErrorText error={models.error} />;
  const m = models.data;
  const writable = can('setModel') && m.version !== null;
  const submit = (input: Omit<ModelInput, 'version'>, confirm = false) => set.mutate({ ...input, version: m.version!, ...(confirm ? { confirm } : {}) });
  const otherError = set.error && !['confirm_required'].includes(errorCode(set.error) ?? '') ? set.error : null;

  return (
    <div className="space-y-4">
      {!writable && <p className="text-sm text-ink-soft">{m.version === null ? 'Écriture impossible : Hermes ne donne pas le fichier de configuration.' : 'Changement de modèle indisponible sur cette instance.'}</p>}
      {confirmFor && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft/40 p-4 text-sm">
          <span>{confirmFor.message}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmFor(null)}>Annuler</Button>
            <Button variant="primary" onClick={() => submit(confirmFor.input, true)}>Confirmer</Button>
          </div>
        </div>
      )}
      {otherError && <p className="text-sm text-bad">{errorCode(otherError) === 'config_changed' ? `${CHANGED_TEXT} Les valeurs ont été relues : recommencez.` : <ErrorText error={otherError} />}</p>}
      {notice && <p className="text-sm text-warn">{notice}</p>}
      <MainModel data={m} disabled={!writable || set.isPending} onSave={(provider, model) => submit({ scope: 'main', provider, model })} onKey={onKey} />
      <Panel title="Modèles auxiliaires"
        action={<Button variant="ghost" disabled={!writable || set.isPending} onClick={() => { if (confirm('Remettre toutes les tâches sur auto ?')) submit({ scope: 'auxiliary', task: '__reset__', provider: 'auto', model: 'auto' }); }}>
          <RotateCcw className={ICON} strokeWidth={1.5} />Tout remettre sur auto</Button>}
        bodyClassName="divide-y divide-line">
        {m.auxiliary.map((t) => (
          <AuxRow key={`${t.task}:${t.provider}:${t.model}`} task={t} providers={m.providers} disabled={!writable || set.isPending}
            onSave={(provider, model) => submit({ scope: 'auxiliary', task: t.task, provider, model })} />
        ))}
      </Panel>
    </div>
  );
}

function useInvalidateOthers(inst: string, profile: string) {
  const qc = useQueryClient();
  // everything but the models themselves (their own refetch would loop)
  return () => qc.invalidateQueries({ queryKey: ['config', inst, profile], predicate: (q) => q.queryKey[3] !== 'models' });
}

function ProviderSelect({ value, providers, onChange, disabled, auto = false }: {
  value: string; providers: ConfigModels['providers']; onChange: (v: string) => void; disabled: boolean; auto?: boolean;
}) {
  const known = providers.some((p) => p.slug === value) || (auto && value === 'auto');
  return (
    <select className={SELECT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Fournisseur">
      {auto && <option value="auto">auto</option>}
      {!known && <option value={value}>{value}</option>}
      {providers.map((p) => <option key={p.slug} value={p.slug}>{p.name}{p.authenticated ? '' : ' (sans clé)'}</option>)}
    </select>
  );
}

function MainModel({ data, disabled, onSave, onKey }: {
  data: ConfigModels; disabled: boolean; onSave: (provider: string, model: string) => void; onKey: (key: string) => void;
}) {
  const [provider, setProvider] = useState(data.main.provider);
  const [model, setModel] = useState(data.main.model);
  const p = data.providers.find((x) => x.slug === provider);
  const changed = provider !== data.main.provider || model !== data.main.model;
  return (
    <Section title="Modèle principal" description="Le modèle qui répond dans les sessions de cet agent, sauf choix fait dans le chat.">
      <div className="card p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">Fournisseur</span>
          <ProviderSelect value={provider} providers={data.providers} onChange={setProvider} disabled={disabled} auto />
        </label>
        <label className="block min-w-64 flex-1">
          <span className="mb-2 block text-sm font-medium">Modèle</span>
          <Input className="font-mono text-[12.5px]" list="main-models" value={model} disabled={disabled} onChange={(e) => setModel(e.target.value)} />
          <datalist id="main-models">{(p?.models ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        </label>
        <Button variant="primary" disabled={disabled || !changed || !model.trim() || !provider} onClick={() => onSave(provider, model.trim())}>
          <Save className={ICON} strokeWidth={1.5} />Enregistrer
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Contexte : {data.main.contextLength ? `${data.main.contextLength.toLocaleString('fr-FR')} jetons` : 'inconnu'}. Le changement vaut pour les nouvelles sessions.
      </p>
      {p && !p.authenticated && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-warn">
          {p.name} n’a pas de clé.
          {p.keyEnv && <Button variant="ghost" className="h-7 px-2" onClick={() => onKey(p.keyEnv!)}><KeyRound className={ICON} strokeWidth={1.5} />Définir {p.keyEnv}</Button>}
        </p>
      )}
      {p?.warning && <p className="mt-1 text-xs text-ink-faint">{p.warning}</p>}
      </div>
    </Section>
  );
}

function AuxRow({ task, providers, disabled, onSave }: {
  task: ConfigModels['auxiliary'][number]; providers: ConfigModels['providers']; disabled: boolean; onSave: (provider: string, model: string) => void;
}) {
  const [provider, setProvider] = useState(task.provider || 'auto');
  const [model, setModel] = useState(task.model);
  const changed = provider !== (task.provider || 'auto') || model !== task.model;
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="w-44 shrink-0 font-mono text-[12.5px]">{task.label ?? task.task}</span>
      <ProviderSelect value={provider} providers={providers} onChange={setProvider} disabled={disabled} auto />
      <Input className="h-9 min-w-48 flex-1 font-mono text-[12.5px]" placeholder={provider === 'auto' ? 'auto' : 'modèle'} value={model} disabled={disabled}
        onChange={(e) => setModel(e.target.value)} aria-label={`Modèle ${task.task}`} />
      <Button disabled={disabled || !changed || (provider !== 'auto' && !model.trim())} onClick={() => onSave(provider, model.trim() || 'auto')}>Enregistrer</Button>
    </div>
  );
}
