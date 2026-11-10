import type { ChatModelList } from '../api';
import type { PickerItem } from '../components/Menu';
import { shortModel } from './format';

/**
 * Items of the chat's model picker: Auto, the agent's list (available models only), the session's model if it is
 * not in it, then "Gérer les modèles…" when the list can be edited.
 */
export function modelItems(list: ChatModelList | undefined, sessionModel: string | null, manage: () => void): PickerItem[] {
  const auto = list?.auto ?? null;
  const names = (list?.models ?? []).filter((m) => m.available).map((m) => m.id);
  if (sessionModel && !names.includes(sessionModel)) names.push(sessionModel);
  return [
    { value: null, label: auto ? `Auto · ${shortModel(auto)}` : 'Auto', hint: 'Le modèle réglé pour l’agent Hermes' },
    ...names.map((n) => ({ value: n, label: n, mono: true })),
    ...(list?.managed ? [{ action: manage, label: 'Gérer les modèles…' }] : []),
  ];
}
