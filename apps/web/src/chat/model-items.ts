import type { ChatModelList } from '../api';
import type { PickerItem } from '../components/Menu';
import { shortModel } from './format';

/** A model choice of the picker: its value is `provider + SEP + model` (a model alone when it has no provider). */
const SEP = '\u0001';

export function encodeChoice(model: string, provider: string | null): string {
  return provider ? `${provider}${SEP}${model}` : model;
}

export function decodeChoice(value: string | null): { model: string | null; provider: string | null } {
  if (value === null) return { model: null, provider: null };
  const i = value.indexOf(SEP);
  return i < 0 ? { model: value, provider: null } : { model: value.slice(i + 1), provider: value.slice(0, i) };
}

/**
 * Items of the chat's model picker: Auto, one group per provider (its title, then its models), the session's model
 * under "Autre" when it is in no group (no provider, removed from the declared list, provider without key), then
 * "Gérer les modèles…" when the declarations can be edited.
 */
export function modelItems(list: ChatModelList | undefined, current: { model: string | null; provider: string | null }, manage: () => void): PickerItem[] {
  const auto = list?.auto ?? null;
  const items: PickerItem[] = [
    { value: null, label: auto ? `Auto · ${shortModel(auto.model)}` : 'Auto', hint: 'Le modèle réglé pour l’agent Hermes' },
  ];
  const groups = list?.groups ?? [];
  for (const g of groups) {
    items.push({ heading: g.name });
    for (const m of g.models) items.push({ value: encodeChoice(m, g.provider), label: m, mono: true });
  }
  if (current.model) {
    const inGroup = groups.some((g) => (current.provider === null || g.provider === current.provider) && g.models.includes(current.model!));
    if (!inGroup) {
      items.push({ heading: 'Autre' });
      items.push({
        value: encodeChoice(current.model, current.provider), label: current.model, mono: true,
        // with a provider, the model is no longer offered (removed, or the provider lost its key)
        ...(current.provider && list ? { hint: `${current.provider} · indisponible` } : {}),
      });
    }
  }
  if (list?.managed) items.push({ action: manage, label: 'Gérer les modèles…' });
  return items;
}

/** The value of the session's current choice in the picker. */
export function currentValue(list: ChatModelList | undefined, current: { model: string | null; provider: string | null }): string | null {
  if (!current.model) return null;
  if (current.provider) return encodeChoice(current.model, current.provider);
  // a model saved without its provider is checked in the first group that has it
  const g = list?.groups.find((x) => x.models.includes(current.model!));
  return g ? encodeChoice(current.model, g.provider) : current.model;
}
