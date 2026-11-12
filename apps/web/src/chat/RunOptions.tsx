import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api, type Effort, type ModelPin, type RunMode } from '../api';
import { ask, askChoice, askText } from '../components/Dialog';
import { Picker, type PickerItem as Item } from '../components/Menu';
import { EFFORTS, effortLabel, shortModel } from './format';
import { currentValue, decodeChoice, isPinned, modeOf, modelItems as pickerModels } from './model-items';

export interface RunPatch { model?: string | null; provider?: string | null; effort?: Effort | null; personality?: string | null }

/**
 * Options of the session's next messages: model (with the agent's modes and pinned models), reasoning effort,
 * personality, and the agent (profile) when the instance has several. "Auto" = what the Hermes agent is set to.
 * Changing the model of a session that already ran asks first: the new model reads the whole conversation again
 * without cache, once.
 */
export function RunOptions({ inst, profile, model, provider, effort, personality, hasRuns, disabled, onChange, onProfile }: {
  inst: string; profile: string; model: string | null; provider: string | null; effort: Effort | null; personality?: string | null;
  hasRuns: boolean; disabled?: boolean;
  onChange: (patch: RunPatch) => void;
  /** another agent of the instance: the page changes it, or copies the session there */
  onProfile?: (profile: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // the agent's models by provider: declared in Hermes, else the catalogue (Configuration › Modèles › Modèles du chat)
  const list = useQuery({ queryKey: ['chat-models', inst, profile], queryFn: () => api.chatModels(inst, profile), enabled: Boolean(inst), retry: false, staleTime: 60_000 });
  const pins = useQuery({ queryKey: ['model-pins', inst, profile], queryFn: () => api.modelPins(inst, profile).then((r) => r.pins), enabled: Boolean(inst), staleTime: 60_000 });
  const modes = useQuery({ queryKey: ['modes', inst, profile], queryFn: () => api.modes(inst, profile).then((r) => r.modes), enabled: Boolean(inst), staleTime: 60_000 });
  const personas = useQuery({ queryKey: ['personalities', inst, profile], queryFn: () => api.personalities(inst, profile), enabled: Boolean(inst), staleTime: 60_000 });
  const agents = useQuery({ queryKey: ['agents', inst], queryFn: () => api.agents(inst).then((r) => r.agents), enabled: Boolean(inst && onProfile), staleTime: 60_000 });

  const manage = () => void navigate({ to: '/i/$inst/config', params: { inst }, search: { profile: profile === 'default' ? undefined : profile, tab: 'modeles' } });
  const current = { model, provider };
  const setPins = async (next: ModelPin[]) => qc.setQueryData(['model-pins', inst, profile], (await api.setModelPins(inst, profile, next)).pins);
  const setModes = async (next: RunMode[]) => qc.setQueryData(['modes', inst, profile], (await api.setModes(inst, profile, next)).modes);
  const togglePin = () => {
    if (!model) return;
    const all = pins.data ?? [];
    void setPins(isPinned(all, current) ? all.filter((p) => !(p.model === model && (p.provider ?? null) === (provider ?? null))) : [...all, { model, provider }]);
  };
  const saveMode = async () => {
    const name = await askText({
      title: 'Enregistrer comme mode', label: 'Nom du mode', maxLength: 60, confirmLabel: 'Enregistrer',
      message: `Modèle ${model ? shortModel(model) : 'Auto'}, effort ${effortLabel(effort)}${personality ? ', avec la personnalité' : ''}. Le mode ne change pas d’agent.`,
    });
    if (!name) return;
    const id = globalThis.crypto.randomUUID();
    await setModes([...(modes.data ?? []), { id, name, model, provider, effort, personality: personality ?? null }]);
  };
  const removeMode = async () => {
    const id = await askChoice({ title: 'Retirer un mode', options: (modes.data ?? []).map((m) => ({ value: m.id, label: m.name })), confirmLabel: 'Retirer' });
    if (id) await setModes((modes.data ?? []).filter((m) => m.id !== id));
  };
  const modelItems = pickerModels(list.data, current, manage, { modes: modes.data, pins: pins.data, togglePin, saveMode: () => void saveMode(), removeMode: () => void removeMode() });
  const value = currentValue(list.data, current);
  const effortItems: Item[] = [
    { value: null, label: 'Auto', hint: 'Le réglage de l’agent Hermes' },
    ...EFFORTS.map((e) => ({ value: e.value, label: e.label, hint: e.hint })),
  ];
  const confirmModel = async () => !hasRuns || ask({ title: 'Changer le modèle de cette session ?', message: 'Le nouveau modèle relira toute la conversation sans cache au prochain message, une fois : ce message coûtera plus cher.', confirmLabel: 'Changer de modèle' });
  const pickModel = async (v: string | null) => {
    const modeId = modeOf(v);
    if (modeId) {
      const m = modes.data?.find((x) => x.id === modeId);
      if (!m) return;
      if (m.model !== model && !(await confirmModel())) return;
      onChange({ model: m.model, provider: m.model ? m.provider : null, effort: m.effort, personality: m.personality });
      return;
    }
    if (!(await confirmModel())) return;
    onChange(decodeChoice(v));
  };

  const newPersonality = async () => {
    const title = await askText({ title: 'Nouvelle personnalité', label: 'Nom', maxLength: 80, confirmLabel: 'Suivant' });
    if (!title) return;
    const body = await askText({ title: `Personnalité « ${title} »`, label: 'Consigne donnée à l’agent à chaque message', maxLength: 20_000, confirmLabel: 'Enregistrer' });
    if (!body) return;
    const { prompt } = await api.createPrompt({ title, body, kind: 'personality' });
    await qc.invalidateQueries({ queryKey: ['personalities'] });
    onChange({ personality: `intendia:${prompt.id}` });
  };
  const personaList = personas.data?.items ?? [];
  const personaItems: Item[] = [
    { value: null, label: 'Aucune', hint: 'Le comportement réglé pour l’agent' },
    ...(personaList.some((p) => p.source === 'hermes') ? [{ heading: 'De l’agent' }] : []),
    ...personaList.filter((p) => p.source === 'hermes').map((p) => ({ value: p.value, label: p.label })),
    ...(personaList.some((p) => p.source === 'intendia') ? [{ heading: 'Intendia' }] : []),
    ...personaList.filter((p) => p.source === 'intendia').map((p) => ({ value: p.value, label: p.label })),
    // a personality removed since: still shown so it can be cleared
    ...(personality && !personaList.some((p) => p.value === personality) && personas.data ? [{ value: personality, label: personality.replace(/^\w+:/, ''), hint: 'introuvable' }] : []),
    { action: () => void newPersonality(), label: 'Nouvelle personnalité…' },
  ];
  const personaLabel = personality ? (personaList.find((p) => p.value === personality)?.label ?? personality.replace(/^\w+:/, '')) : null;

  const withKey = (agents.data ?? []).filter((a) => a.hasKey);
  const profileItems: Item[] = withKey.map((a) => ({ value: a.name, label: a.name, ...(a.name === profile ? { hint: 'cette session' } : {}) }));

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {onProfile && withKey.length > 1 && (
        <Picker
          title="Agent de cette session" items={profileItems} value={profile} disabled={disabled}
          onPick={(v) => { if (v && v !== profile) onProfile(v); }}
          label={<><span className="hidden sm:inline">Agent : </span>{profile}</>}
        />
      )}
      <Picker
        // not before the agent's models are read: the menu would only offer Auto
        title="Modèle des prochains messages" items={modelItems} value={value} disabled={disabled || list.isLoading} onPick={pickModel}
        label={model ? <span className="font-mono">{shortModel(model)}</span> : (modelItems.find((i) => 'value' in i && i.value === null) as { label: string }).label}
      />
      <Picker
        title="Effort de raisonnement" items={effortItems} value={effort} disabled={disabled}
        onPick={(v) => onChange({ effort: v as Effort | null })}
        label={<><span className="hidden sm:inline">Effort : </span><span className="sm:hidden">Effort </span>{effortLabel(effort)}</>}
      />
      <Picker
        title="Personnalité de la session" items={personaItems} value={personality ?? null} disabled={disabled}
        onPick={(v) => onChange({ personality: v })}
        label={personaLabel ? <span className="max-w-[8rem] truncate">{personaLabel}</span> : <span className="hidden lg:inline">Personnalité</span>}
      />
    </div>
  );
}
