import type { Blueprint, BlueprintField } from '../api';

/**
 * Input of a template field: a time picker, a select for a closed list (Hermes `enum`, `weekdays`), a text input
 * with suggestions when the options are not strict (Hermes' `deliver`), else a text input.
 */
export type FieldControl = 'time' | 'select' | 'suggest' | 'text';

export function controlOf(f: BlueprintField): FieldControl {
  if (f.type === 'time') return 'time';
  if (!f.options.length) return 'text';
  return f.strict ? 'select' : 'suggest';
}

/** Hermes' named weekday recurrences, in French; other option labels are shown as Hermes sends them. */
const WEEKDAY_LABELS: Record<string, string> = { everyday: 'tous les jours', weekdays: 'du lundi au vendredi', weekends: 'le week-end' };

export function optionLabel(f: BlueprintField, o: { value: string; label: string }): string {
  return f.type === 'weekdays' ? WEEKDAY_LABELS[o.value] ?? o.label : o.label;
}

/** Starting values: the template's default, else the first option of a select, else empty. */
export function blueprintDefaults(bp: Blueprint): Record<string, string> {
  return Object.fromEntries(bp.fields.map((f) => [f.name, f.default ?? (controlOf(f) === 'select' ? f.options[0]!.value : '')]));
}

/** Fields that are required and still empty. */
export function missingFields(bp: Blueprint, values: Record<string, string>): BlueprintField[] {
  return bp.fields.filter((f) => !f.optional && !(values[f.name] ?? '').trim());
}

/** Values sent to Hermes: only the template's own fields, trimmed; an empty optional field is left out. */
export function blueprintValues(bp: Blueprint, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of bp.fields) {
    const v = (values[f.name] ?? '').trim();
    if (v) out[f.name] = v;
  }
  return out;
}
