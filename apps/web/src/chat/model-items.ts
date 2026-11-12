import type { ChatModelList, ModelPin, RunMode } from '../api';
import type { PickerItem } from '../components/Menu';
import { shortModel } from './format';

/** A model choice of the picker: its value is `provider + SEP + model` (a model alone when it has no provider). */
const SEP = '\u0001';

export function encodeChoice(model: string, provider: string | null): string {
  return provider ? `${provider}${SEP}${model}` : model;
}

/** A pinned model is also listed in its group: its own value, so the two lines are distinct. */
const PIN = '\u0002';
/** A mode: applies its model, effort and personality. */
const MODE = '\u0003';

export const modeValue = (id: string) => `${MODE}${id}`;
export const modeOf = (value: string | null): string | null => (value?.startsWith(MODE) ? value.slice(1) : null);

export function decodeChoice(value: string | null): { model: string | null; provider: string | null } {
  if (value === null) return { model: null, provider: null };
  if (value.startsWith(PIN)) value = value.slice(1);
  const i = value.indexOf(SEP);
  return i < 0 ? { model: value, provider: null } : { model: value.slice(i + 1), provider: value.slice(0, i) };
}

/**
 * Items of the chat's model picker: Auto, one folded group per provider (its title, then its models), the session's model
 * under "Autre" when it is in no group (no provider, removed from the declared list, provider without key), then
 * "Gérer les modèles…" when the declarations can be edited.
 */
export interface ModelExtras {
  modes?: RunMode[];
  pins?: ModelPin[];
  /** pin or unpin the session's current model */
  togglePin?: () => void;
  saveMode?: () => void;
  removeMode?: () => void;
}

export const isPinned = (pins: ModelPin[] | undefined, c: { model: string | null; provider: string | null }) =>
  Boolean(c.model && pins?.some((p) => p.model === c.model && (p.provider ?? null) === (c.provider ?? null)));

export function modelItems(
  list: ChatModelList | undefined, current: { model: string | null; provider: string | null }, manage: () => void, extras: ModelExtras = {},
): PickerItem[] {
  const auto = list?.auto ?? null;
  const items: PickerItem[] = [];
  if (extras.modes?.length) {
    items.push({ heading: 'Modes' });
    for (const m of extras.modes) {
      const what = [m.model ? shortModel(m.model) : 'Auto', m.effort ? `effort ${m.effort}` : null, m.personality ? 'personnalité' : null].filter(Boolean).join(' · ');
      items.push({ value: modeValue(m.id), label: m.name, hint: what });
    }
  }
  items.push({ value: null, label: auto ? `Auto · ${shortModel(auto.model)}` : 'Auto', hint: 'Le modèle réglé pour l’agent' });
  if (extras.pins?.length) {
    items.push({ heading: 'Épinglés' });
    for (const p of extras.pins) items.push({ value: `${PIN}${encodeChoice(p.model, p.provider)}`, label: p.model, mono: true, ...(p.provider ? { hint: p.provider } : {}) });
  }
  const groups = list?.groups ?? [];
  for (const g of groups) {
    items.push({ heading: g.name, collapsible: true });
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
  if (extras.togglePin && current.model) {
    items.push({ action: extras.togglePin, label: isPinned(extras.pins, current) ? 'Retirer des épinglés' : 'Épingler ce modèle' });
  }
  if (extras.saveMode) items.push({ action: extras.saveMode, label: 'Enregistrer le réglage actuel comme mode…' });
  if (extras.removeMode && extras.modes?.length) items.push({ action: extras.removeMode, label: 'Retirer un mode…' });
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
