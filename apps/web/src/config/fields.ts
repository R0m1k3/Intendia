import type { ConfigField } from '../api';

/** How the generated form shows a field, and the conversions between the input text and the value. */

export type EditorKind = 'boolean' | 'number' | 'select' | 'text' | 'lines' | 'readonly';

export const SECRET_MARK = '«secret:';

export function isMasked(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(SECRET_MARK);
  if (Array.isArray(value)) return value.some(isMasked);
  if (value && typeof value === 'object') return Object.values(value).some(isMasked);
  return false;
}

const scalar = (v: unknown) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

export function editorKind(field: ConfigField, value: unknown): EditorKind {
  if (isMasked(value)) return 'readonly';
  switch (field.type) {
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'select': return 'select';
    // Hermes types every field whose default is None as `string`: follow the value when it is not text
    case 'string': return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
    case 'list': return Array.isArray(value) && value.every(scalar) ? 'lines' : value == null ? 'lines' : 'readonly';
    default: return 'readonly';
  }
}

export function toText(kind: EditorKind, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (kind === 'lines') return Array.isArray(value) ? value.join('\n') : '';
  if (kind === 'readonly') return typeof value === 'string' ? value : JSON.stringify(value);
  return String(value);
}

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/** Value to send for an input text; `original` keeps numbers in a list or a loose `string` field. */
export function fromText(kind: EditorKind, text: string, original: unknown): Parsed {
  switch (kind) {
    case 'number': {
      const n = Number(text.trim());
      return text.trim() !== '' && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'nombre attendu' };
    }
    case 'lines': {
      const numeric = Array.isArray(original) && original.length > 0 && original.every((v) => typeof v === 'number');
      const items = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (numeric) {
        const nums = items.map(Number);
        return nums.every(Number.isFinite) ? { ok: true, value: nums } : { ok: false, error: 'nombres attendus, un par ligne' };
      }
      return { ok: true, value: items };
    }
    case 'text':
      // an unset loose field (null) that receives digits gets a number, like YAML would read it
      if (original === null && /^-?\d+(\.\d+)?$/.test(text.trim())) return { ok: true, value: Number(text.trim()) };
      return { ok: true, value: text };
    default:
      return { ok: true, value: text };
  }
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface Change { path: string; before: unknown; after: unknown }

/** Pending edits that really differ from the values read (an edit back to the start value is dropped). */
export function changeList(values: Record<string, unknown>, pending: Record<string, unknown>): Change[] {
  return Object.entries(pending)
    .filter(([path, v]) => !same(values[path] ?? null, v))
    .map(([path, after]) => ({ path, before: values[path] ?? null, after }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Pending edits re-applied on freshly read values: paths gone from the schema are dropped and reported. */
export function reapply(pending: Record<string, unknown>, schema: Record<string, ConfigField>): { kept: Record<string, unknown>; dropped: string[] } {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [path, v] of Object.entries(pending)) (path in schema ? (kept[path] = v) : dropped.push(path));
  return { kept, dropped };
}

export function display(value: unknown): string {
  if (value === null || value === undefined) return '(vide)';
  if (typeof value === 'string') return value === '' ? '""' : value;
  return JSON.stringify(value);
}
