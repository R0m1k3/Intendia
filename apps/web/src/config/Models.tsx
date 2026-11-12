import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ConfigModels, type ModelInput } from '../api';
import { Button, ErrorText, Input, Panel } from '../components/ui';
import { ConfigBox } from './Box';
import { auxLabel } from './aux-labels';
import { AUTO, changesOf, extraLabel, optionGroups, optionValue, OTHER, parseOption, valueOf } from './aux-draft';
import { ChatModels } from './ChatModels';
import { CHANGED_TEXT, configKey, errorCode, errorData, ICON, SELECT, useInvalidateConfig, type TabProps } from './common';
import { ask } from '../components/Dialog';

/** Main model and auxiliary tasks; the provider key is set in the Variables tab, never here. */
export function ConfigModelsTab({ inst, profile, can, onSaved, onKey, onProviders }: TabProps & { onKey: (key: string) => void; onProviders?: () => void }) {
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
    <div className="space-y-5">
      {!writable && <p className="text-sm text-ink-soft">{m.version === null ? 'Écriture impossible : Hermes ne donne pas le fichier de configuration.' : 'Changement de modèle indisponible sur cette instance.'}</p>}
      {confirmFor && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn">
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
      <ChatModels inst={inst} profile={profile} providers={m.providers} writable={m.version !== null} onProviders={onProviders} />
      <AuxModels inst={inst} profile={profile} data={m} writable={writable} busy={set.isPending}
        onReset={() => submit({ scope: 'auxiliary', task: '__reset__', provider: 'auto', model: 'auto' })}
        onSaved={async (n) => { setNotice(n); await invalidate(); onSaved(false); }} />
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
    <ConfigBox id="cf-m" title="Modèle principal" description="Le modèle qui répond dans les sessions de cet agent, sauf choix fait dans le chat.">
      <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">Fournisseur</span>
          <ProviderSelect value={provider} providers={data.providers} onChange={setProvider} disabled={disabled} auto />
        </label>
        <label className="block min-w-64 flex-1">
          <span className="mb-1.5 block text-[13px] font-medium">Modèle</span>
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
    </ConfigBox>
  );
}

/** One row per task, a single list each; the changes wait in a draft and are saved all at once (all or nothing). */
function AuxModels({ inst, profile, data, writable, busy, onReset, onSaved }: {
  inst: string; profile: string; data: ConfigModels; writable: boolean; busy: boolean;
  onReset: () => void; onSaved: (notice: string | null) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Set<string>>(new Set());
  const [confirmMsg, setConfirmMsg] = useState<{ task: string | null; message: string } | null>(null);
  const changes = changesOf(draft, data.auxiliary);
  const save = useMutation({
    mutationFn: (confirm: boolean) => api.setAuxiliary(inst, profile, { version: data.version!, changes, ...(confirm ? { confirm } : {}) }),
    onSuccess: async (res) => {
      setDraft({});
      setOther(new Set());
      setConfirmMsg(null);
      await onSaved(res.notice ?? null);
    },
    onError: async (err) => {
      const code = errorCode(err);
      if (code === 'confirm_required') {
        const d = errorData(err);
        setConfirmMsg({ task: typeof d.task === 'string' ? d.task : null, message: String(d.message ?? 'Confirmer ?') });
        return;
      }
      setConfirmMsg(null);
      // stale version, or a write that may be partial: reread (the draft is compared to the new values)
      if (code === 'config_changed' || code === 'partial_write') await qc.invalidateQueries({ queryKey: configKey(inst, profile, 'models') });
    },
  });
  const cancel = () => { setDraft({}); setOther(new Set()); setConfirmMsg(null); save.reset(); };
  const disabled = !writable || busy || save.isPending;
  const error = save.error && errorCode(save.error) !== 'confirm_required' ? save.error : null;
  const n = changes.length;
  const confirmLabel = confirmMsg?.task ? auxLabel(confirmMsg.task, data.auxiliary.find((t) => t.task === confirmMsg.task)?.label ?? null) : null;

  return (
    <Panel title="Modèles auxiliaires"
      action={<Button variant="ghost" disabled={disabled || n > 0} title={n > 0 ? 'Enregistrez ou annulez d’abord les modifications' : undefined}
        onClick={async () => { if (await ask({ title: 'Remettre toutes les tâches sur auto ?', confirmLabel: 'Remettre sur auto' })) onReset(); }}>
        <RotateCcw className={ICON} strokeWidth={1.5} />Tout remettre sur auto</Button>}
      bodyClassName="divide-y divide-line/70 border-t border-line/70">
      {data.auxiliary.map((t) => (
        <AuxRow key={t.task} task={t} providers={data.providers} disabled={disabled}
          value={draft[t.task] ?? valueOf(t)} other={other.has(t.task)}
          onChange={(v, isOther) => {
            setOther((cur) => { const next = new Set(cur); if (isOther) next.add(t.task); else next.delete(t.task); return next; });
            setDraft((cur) => ({ ...cur, [t.task]: v }));
            setConfirmMsg(null);
          }} />
      ))}
      {(n > 0 || confirmMsg || error) && (
        <div data-aux-bar className="sticky bottom-4 z-10 max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))] mx-3 my-3 rounded-xl bg-ink px-4 py-3 text-sm text-sheet shadow-[0_8px_24px_rgb(22_24_27/0.25)]">
          {confirmMsg && (
            <div data-aux-confirm className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-sheet/20 pb-3">
              <span>{confirmLabel ? `${confirmLabel} : ` : ''}{confirmMsg.message}</span>
              <button type="button" onClick={() => save.mutate(true)} disabled={save.isPending}
                className="h-8 rounded-lg bg-sheet px-3 text-[13px] font-medium text-ink transition-opacity hover:opacity-90">Confirmer</button>
            </div>
          )}
          {error && (
            <p role="alert" className="mb-3 border-b border-sheet/20 pb-3 text-[13px]">
              {errorCode(error) === 'config_changed' ? `${CHANGED_TEXT} Les valeurs ont été relues : vérifiez puis enregistrez de nouveau.` : (error as Error).message}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{n === 0 ? 'Aucune modification' : `${n} modification${n > 1 ? 's' : ''} non enregistrée${n > 1 ? 's' : ''}`}</span>
            <div className="flex gap-2">
              <button type="button" onClick={cancel} className="h-8 rounded-lg px-3 text-[13px] font-medium text-sheet/80 transition-colors hover:text-sheet">Annuler</button>
              <button type="button" onClick={() => save.mutate(false)} disabled={disabled || n === 0}
                className="h-8 rounded-lg bg-sheet px-3 text-[13px] font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50">
                {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function AuxRow({ task, providers, disabled, value, other, onChange }: {
  task: ConfigModels['auxiliary'][number]; providers: ConfigModels['providers']; disabled: boolean;
  value: string; other: boolean; onChange: (value: string, other: boolean) => void;
}) {
  const changed = value !== valueOf(task);
  const { groups, extra } = optionGroups(providers, value);
  const custom = parseOption(value);
  const firstKeyed = providers.find((p) => p.authenticated)?.slug ?? providers[0]?.slug ?? 'auto';
  const label = auxLabel(task.task, task.label);
  return (
    <div data-aux={task.task} className="px-4 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 md:w-52 md:shrink-0">
          <p className="text-sm font-medium">
            {label}
            {changed && <span className="font-normal text-accent-ink"> · modifié</span>}
          </p>
          <p className="font-mono text-[11.5px] text-ink-faint">{task.task}</p>
        </div>
        <select className={`${SELECT} w-full min-w-0 md:flex-1`} disabled={disabled} aria-label={`Modèle : ${label}`}
          value={other ? OTHER : value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) onChange(value === AUTO ? optionValue(firstKeyed, '') : value, true);
            else onChange(v, false);
          }}>
          <option value={AUTO}>Auto · modèle principal</option>
          {extra && !other && <option value={extra}>{extraLabel(extra)}</option>}
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
          <option value={OTHER}>Autre…</option>
        </select>
      </div>
      {other && (
        <div className="mt-2 flex flex-wrap items-center gap-2 md:pl-56">
          <ProviderSelect value={custom.provider} providers={providers} disabled={disabled} auto
            onChange={(p) => onChange(optionValue(p, custom.model), true)} />
          <Input className="h-9 min-w-48 flex-1 font-mono text-[12.5px]" placeholder="modèle" value={custom.model} disabled={disabled}
            aria-label={`Autre modèle : ${label}`} onChange={(e) => onChange(optionValue(custom.provider, e.target.value), true)} />
        </div>
      )}
    </div>
  );
}
