import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api, type Effort } from '../api';
import { Picker, type PickerItem as Item } from '../components/Menu';
import { EFFORTS, effortLabel, shortModel } from './format';
import { currentValue, decodeChoice, modelItems as pickerModels } from './model-items';

/**
 * Model and reasoning effort of the session's next messages. "Auto" = what the Hermes agent is set to.
 * Changing the model of a session that already ran asks first: the new model reads the whole
 * conversation again without cache, once.
 */
export function RunOptions({ inst, profile, model, provider, effort, hasRuns, disabled, onChange }: {
  inst: string; profile: string; model: string | null; provider: string | null; effort: Effort | null; hasRuns: boolean; disabled?: boolean;
  onChange: (patch: { model?: string | null; provider?: string | null; effort?: Effort | null }) => void;
}) {
  const navigate = useNavigate();
  // the agent's models by provider: declared in Hermes, else the catalogue (Configuration › Modèles › Modèles du chat)
  const list = useQuery({ queryKey: ['chat-models', inst, profile], queryFn: () => api.chatModels(inst, profile), enabled: Boolean(inst), retry: false, staleTime: 60_000 });
  const manage = () => void navigate({ to: '/i/$inst/config', params: { inst }, search: { profile: profile === 'default' ? undefined : profile, tab: 'modeles' } });
  const current = { model, provider };
  const modelItems = pickerModels(list.data, current, manage);
  const value = currentValue(list.data, current);
  const effortItems: Item[] = [
    { value: null, label: 'Auto', hint: 'Le réglage de l’agent Hermes' },
    ...EFFORTS.map((e) => ({ value: e.value, label: e.label, hint: e.hint })),
  ];
  const pickModel = (v: string | null) => {
    if (hasRuns && !confirm('Changer le modèle de cette session ? Le nouveau modèle relira toute la conversation sans cache au prochain message, une fois : ce message coûtera plus cher.')) return;
    onChange(decodeChoice(v));
  };
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Picker
        // not before the agent's models are read: the menu would only offer Auto
        title="Modèle des prochains messages" items={modelItems} value={value} disabled={disabled || list.isLoading} onPick={pickModel}
        label={model ? <span className="font-mono">{shortModel(model)}</span> : (modelItems[0] as { label: string }).label}
      />
      <Picker
        title="Effort de raisonnement" items={effortItems} value={effort} disabled={disabled}
        onPick={(v) => onChange({ effort: v as Effort | null })}
        label={<><span className="hidden sm:inline">Effort : </span><span className="sm:hidden">Effort </span>{effortLabel(effort)}</>}
      />
    </div>
  );
}
