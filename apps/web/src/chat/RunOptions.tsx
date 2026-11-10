import { useQuery } from '@tanstack/react-query';
import { api, type Effort } from '../api';
import { Picker, type PickerItem as Item } from '../components/Menu';
import { EFFORTS, effortLabel, shortModel } from './format';
import { modelNames } from './models';

/**
 * Model and reasoning effort of the session's next messages. "Auto" = what the Hermes agent is set to.
 * Changing the model of a session that already ran asks first: the new model reads the whole
 * conversation again without cache, once.
 */
export function RunOptions({ inst, profile, model, effort, hasRuns, disabled, onChange }: {
  inst: string; profile: string; model: string | null; effort: Effort | null; hasRuns: boolean; disabled?: boolean;
  onChange: (patch: { model?: string | null; effort?: Effort | null }) => void;
}) {
  const options = useQuery({ queryKey: ['models', inst, profile], queryFn: () => api.models(inst, profile), enabled: Boolean(inst), retry: false, staleTime: 60_000 });
  const fallback = options.data?.model ?? null;
  const names = modelNames(options.data);
  if (model && !names.includes(model)) names.unshift(model);
  const modelItems: Item[] = [
    { value: null, label: fallback ? `Auto · ${shortModel(fallback)}` : 'Auto', hint: 'Le modèle réglé pour l’agent Hermes' },
    ...names.map((n) => ({ value: n, label: n, mono: true })),
  ];
  const effortItems: Item[] = [
    { value: null, label: 'Auto', hint: 'Le réglage de l’agent Hermes' },
    ...EFFORTS.map((e) => ({ value: e.value, label: e.label, hint: e.hint })),
  ];
  const pickModel = (v: string | null) => {
    if (hasRuns && !confirm('Changer le modèle de cette session ? Le nouveau modèle relira toute la conversation sans cache au prochain message, une fois : ce message coûtera plus cher.')) return;
    onChange({ model: v });
  };
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Picker
        title="Modèle des prochains messages" items={modelItems} value={model} disabled={disabled} onPick={pickModel}
        label={model ? <span className="font-mono">{shortModel(model)}</span> : modelItems[0]!.label}
      />
      <Picker
        title="Effort de raisonnement" items={effortItems} value={effort} disabled={disabled}
        onPick={(v) => onChange({ effort: v as Effort | null })}
        label={<><span className="hidden sm:inline">Effort : </span><span className="sm:hidden">Effort </span>{effortLabel(effort)}</>}
      />
    </div>
  );
}
