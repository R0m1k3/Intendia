import type { HermesConfigField } from '../connectors/config/index.js';

/**
 * Hermes publishes its config schema as flat dotted paths (`terminal.backend`). These helpers move between
 * that flat view and the nested config, and check values against a field before Intendia writes them.
 */

export type Fields = Record<string, HermesConfigField>;

/** Paths managed elsewhere: `model` is a table in the file but a string in the schema. */
export const MODEL_PATHS = new Set(['model', 'model_context_length']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Flat path → value for the paths of the schema. Descends into tables and stops on any schema path
 * (a leaf, even when its value is a table or a list); lists are never walked.
 */
export function flatten(obj: unknown, fields: Fields, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (path in fields) out[path] = v;
    else if (isPlainObject(v)) Object.assign(out, flatten(v, fields, path));
  }
  return out;
}

/** Nested object from flat paths. */
export function unflatten(changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.');
    let node = out;
    for (const k of keys.slice(0, -1)) {
      if (!isPlainObject(node[k])) node[k] = {};
      node = node[k] as Record<string, unknown>;
    }
    node[keys[keys.length - 1]!] = value;
  }
  return out;
}

/** null when the value fits the field, else the reason. */
export function checkValue(field: HermesConfigField, value: unknown, opts: { allowNull?: boolean } = {}): string | null {
  if (value === null) return opts.allowNull ? null : 'valeur vide refusée';
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'booléen attendu';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'nombre attendu';
    case 'string':
      // Hermes types every field whose default is None as `string` (agent.max_turns holds 500): loose
      return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
        ? null : 'texte attendu';
    case 'select': {
      if (value === '' && field.clearable) return null;
      const options = (field.options ?? []).map((o) => (o && typeof o === 'object' && 'value' in o ? (o as { value: unknown }).value : o));
      return options.some((o) => o === value) ? null : 'valeur hors de la liste';
    }
    case 'list':
      return Array.isArray(value) && value.every((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
        ? null : 'liste de textes ou de nombres attendue';
    default:
      // `object` and unknown types are not edited by the form
      return 'champ non modifiable par le formulaire';
  }
}

/**
 * Checks a whole document (YAML editor): every schema path present must have the right type, `null` empties.
 * Not checked: model paths, paths absent from the schema (`mcp_servers`, `providers`...), `object` fields and
 * lists of tables (the schema does not describe their items). Returns the faulty paths.
 */
export function validateDoc(obj: unknown, fields: Fields): string[] {
  const bad: string[] = [];
  for (const [path, value] of Object.entries(flatten(obj, fields))) {
    const field = fields[path]!;
    if (MODEL_PATHS.has(path) || field.type === 'object' || field.type === undefined) continue;
    if (field.type === 'list' && Array.isArray(value) && value.some((v) => v !== null && typeof v === 'object')) continue;
    if (checkValue(field, value, { allowNull: true })) bad.push(path);
  }
  return bad;
}
