import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Picker, type PickerItem } from '../components/Menu';
import { shortModel } from '../chat/format';
import { currentValue, decodeChoice, modelItems } from '../chat/model-items';

/**
 * The chat's model picker (one group per provider with a key) for an agent's default model. `null` = none chosen:
 * only offered when `noneLabel` is given (creation: Hermes' default).
 */
export function AgentModelPicker({ inst, profile, model, provider, onPick, disabled, noneLabel, title = 'Modèle par défaut de l’agent' }: {
  inst: string; profile: string; model: string | null; provider: string | null;
  onPick: (choice: { model: string; provider: string } | null) => void;
  disabled?: boolean; noneLabel?: string; title?: string;
}) {
  const list = useQuery({ queryKey: ['chat-models', inst, profile], queryFn: () => api.chatModels(inst, profile), retry: false, staleTime: 60_000 });
  const current = { model, provider };
  const items: PickerItem[] = modelItems(list.data, current, () => {})
    // "Auto" is the session's setting: here, either "none" (creation) or nothing
    .flatMap((it) => ('value' in it && it.value === null ? (noneLabel ? [{ ...it, label: noneLabel, hint: 'Le modèle par défaut d’Hermes' }] : []) : [it]))
    .filter((it) => !('action' in it));
  return (
    <Picker
      title={title} items={items} value={currentValue(list.data, current)} disabled={disabled || list.isLoading} placement="below"
      triggerClass="inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border border-line bg-sheet px-2.5 text-sm hover:border-ink-faint/60"
      onPick={(v) => {
        const c = decodeChoice(v);
        if (!c.model) { if (noneLabel) onPick(null); return; }
        // a model without provider (Autre) cannot be set: Hermes needs both
        if (c.provider) onPick({ model: c.model, provider: c.provider });
      }}
      label={model ? <span className="truncate font-mono">{shortModel(model)}</span> : <span className="text-ink-soft">{noneLabel ?? 'Choisir un modèle'}</span>}
    />
  );
}
