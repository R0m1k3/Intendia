// Draft of the auxiliary models: one value per task, saved all at once (POST …/config/auxiliary).
import type { ConfigModels } from '../api';

type Task = ConfigModels['auxiliary'][number];
type Provider = ConfigModels['providers'][number];

/** Value of a <select> option: provider and model on two lines. */
export const optionValue = (provider: string, model: string): string => `${provider}\n${model}`;
export function parseOption(v: string): { provider: string; model: string } {
  const i = v.indexOf('\n');
  return i < 0 ? { provider: v, model: '' } : { provider: v.slice(0, i), model: v.slice(i + 1) };
}

/** "Auto · modèle principal": the task follows the main model. */
export const AUTO = optionValue('auto', 'auto');
/** "Autre…": provider and model typed by hand. */
export const OTHER = '__other__';

/** The task's value as Hermes has it (every auto form is AUTO). */
export function valueOf(t: Pick<Task, 'provider' | 'model'>): string {
  return !t.provider || t.provider === 'auto' ? AUTO : optionValue(t.provider, t.model);
}

export interface OptionGroup { label: string; options: { value: string; label: string }[] }

/** Groups of the list: one per provider with a key; `extra` = a value found in none of them (kept as an option). */
export function optionGroups(providers: Provider[], value: string): { groups: OptionGroup[]; extra: string | null } {
  const groups = providers.filter((p) => p.authenticated && p.models.length > 0).map((p) => ({
    label: p.name, options: p.models.map((m) => ({ value: optionValue(p.slug, m), label: m })),
  }));
  const known = value === AUTO || groups.some((g) => g.options.some((o) => o.value === value));
  return { groups, extra: known ? null : value };
}

/** Label of a value outside the lists: "model · provider". */
export function extraLabel(value: string): string {
  const { provider, model } = parseOption(value);
  return model ? `${model} · ${provider}` : provider;
}

/** Tasks whose draft differs from Hermes's value, as sent to the server. */
export function changesOf(draft: Record<string, string>, tasks: Task[]): { task: string; provider: string; model: string }[] {
  const out: { task: string; provider: string; model: string }[] = [];
  for (const t of tasks) {
    const v = draft[t.task];
    if (v === undefined || v === valueOf(t)) continue;
    const { provider, model } = parseOption(v);
    out.push({ task: t.task, provider: provider.trim() || 'auto', model: model.trim() || 'auto' });
  }
  return out;
}
