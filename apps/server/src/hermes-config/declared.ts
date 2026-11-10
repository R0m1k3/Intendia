/**
 * Models declared per provider in the Hermes config file (`providers.<key>.models`), read from the raw text.
 * Port of Hermes 0.23.0 `_declared_model_ids` (its model_switch module): a string, a list of strings or of
 * `{id|name}` objects, or a `{id: metadata}` mapping; duplicates dropped case-insensitively.
 */
import { parse } from './mask.js';

export type DeclaredShape = 'strings' | 'string' | 'objects' | 'dict' | 'none';
export interface Declared {
  ids: string[];
  shape: DeclaredShape;
  /** The entry is a custom endpoint (`base_url`, `url` or `api`): its models are its own allowlist. */
  custom: boolean;
}

const SENTINELS = new Set(['__explicit_model_allowlist__', '__discovered_model_catalog__']);
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function shapeOf(v: unknown): DeclaredShape {
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return v.some((x) => isObj(x)) ? 'objects' : 'strings';
  if (isObj(v)) return 'dict';
  return 'none';
}

export function declaredIds(v: unknown): string[] {
  let candidates: unknown[];
  if (typeof v === 'string') candidates = [v];
  else if (isObj(v)) candidates = Object.keys(v).filter((k) => !SENTINELS.has(k));
  else if (Array.isArray(v)) {
    candidates = v.map((x) => {
      if (!isObj(x)) return x;
      return typeof x.id === 'string' && x.id.trim() ? x.id : x.name;
    });
  } else return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const id = c.trim();
    if (id && !seen.has(id.toLowerCase())) {
      seen.add(id.toLowerCase());
      out.push(id);
    }
  }
  return out;
}

/** Declared models of every `providers.<key>` entry of the file (empty map when the text has none). */
export function declaredModels(text: string): Map<string, Declared> {
  const out = new Map<string, Declared>();
  let doc: unknown;
  try {
    doc = parse(text).toJS();
  } catch {
    return out;
  }
  const providers = isObj(doc) ? doc.providers : undefined;
  if (!isObj(providers)) return out;
  for (const [key, entry] of Object.entries(providers)) {
    if (!isObj(entry)) continue;
    out.set(key, {
      ids: declaredIds(entry.models),
      shape: shapeOf(entry.models),
      custom: ['base_url', 'url', 'api'].some((k) => typeof entry[k] === 'string' && entry[k] !== ''),
    });
  }
  return out;
}

/** Shapes Intendia can rewrite as a plain list without losing anything. */
export function editableShape(shape: DeclaredShape): boolean {
  return shape === 'strings' || shape === 'string' || shape === 'none';
}
