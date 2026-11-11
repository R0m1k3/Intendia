/**
 * Custom endpoints (OpenAI-compatible servers: Ollama, vLLM, a proxy…) of the Hermes config file. Hermes 0.23 reads
 * them from `providers.<slug>` (v12 shape: `name`, `api`, `key_env`, `default_model`, `models`) and from the old
 * `custom_providers` list (its config_providers module). Intendia writes only the v12 shape, its key always in a
 * variable (`key_env`), never in the file. Old entries are shown, not changed (YAML tab).
 */
import { isMap } from 'yaml';
import { ConfigInputError } from './service.js';
import { parse } from './mask.js';

export interface PublicCustomProvider {
  /** Key of `providers` (v12 shape); null for an old `custom_providers` entry. */
  slug: string | null;
  name: string;
  baseUrl: string;
  model: string | null;
  key: { kind: 'env'; name: string; set: boolean } | { kind: 'inline' } | null;
  legacy: boolean;
}

/** Raw shape before the env check (`set` filled by the caller). */
export type ReadCustomProvider = Omit<PublicCustomProvider, 'key'> & { key: { kind: 'env'; name: string } | { kind: 'inline' } | null };

/** Hermes aliases of `custom` (comment « Aliases » of its config template, 0.23). */
export const HERMES_ALIASES = ['custom', 'auto', 'ollama', 'vllm', 'llamacpp'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function keyOf(e: Record<string, unknown>): ReadCustomProvider['key'] {
  const env = str(e.key_env) || str(e.api_key_env);
  if (env) return { kind: 'env', name: env };
  if (str(e.api_key)) return { kind: 'inline' };
  return null;
}

/** Custom endpoints of the file; [] when the text has none or does not parse. */
export function readCustomProviders(text: string): ReadCustomProvider[] {
  let doc: unknown;
  try {
    doc = parse(text).toJS();
  } catch {
    return [];
  }
  if (!isObj(doc)) return [];
  const out: ReadCustomProvider[] = [];
  if (isObj(doc.providers)) {
    for (const [slug, e] of Object.entries(doc.providers)) {
      if (!isObj(e)) continue;
      const baseUrl = str(e.api) || str(e.base_url) || str(e.url);
      if (!baseUrl) continue;
      out.push({ slug, name: str(e.name) || slug, baseUrl, model: str(e.default_model) || str(e.model) || null, key: keyOf(e), legacy: false });
    }
  }
  if (Array.isArray(doc.custom_providers)) {
    for (const e of doc.custom_providers) {
      if (!isObj(e)) continue;
      const baseUrl = str(e.base_url) || str(e.url) || str(e.api);
      if (!baseUrl) continue;
      out.push({ slug: null, name: str(e.name) || baseUrl, baseUrl, model: str(e.model) || str(e.default_model) || null, key: keyOf(e), legacy: true });
    }
  }
  return out;
}

/** « Ollama maison » → `ollama-maison`; '' when nothing is left. */
export function slugFor(name: string): string {
  return name.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
}

/** Variable that holds the key of an endpoint added by Intendia: `INTENDIA_OLLAMA_MAISON_API_KEY`. */
export const keyEnvFor = (slug: string) => `INTENDIA_${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`;

/** Checks the input of a new endpoint; returns its slug and the cleaned URL. */
export function checkEndpoint(input: { name: string; baseUrl: string; model?: string }): { slug: string; name: string; baseUrl: string; model: string | null } {
  const name = input.name.trim();
  if (!name || name.length > 64) throw new ConfigInputError('invalid', 'Nom : 1 à 64 caractères');
  const slug = slugFor(name);
  if (!slug) throw new ConfigInputError('invalid', 'Nom : il faut au moins une lettre ou un chiffre');
  let url: URL;
  try {
    url = new URL(input.baseUrl.trim());
  } catch {
    throw new ConfigInputError('invalid', 'Adresse invalide : http://… ou https://…');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigInputError('invalid', 'Adresse invalide : http://… ou https://…');
  if (url.username || url.password) throw new ConfigInputError('invalid', 'Pas d’identifiants dans l’adresse : mettez la clé dans le champ Clé');
  const model = input.model?.trim() || null;
  return { slug, name, baseUrl: input.baseUrl.trim().replace(/\/+$/, ''), model };
}

/** The text without `providers.<slug>` (rest of the file untouched by Intendia; Hermes rewrites it on save). */
export function withoutProvider(text: string, slug: string): string {
  const doc = parse(text);
  const providers = doc.get('providers', true);
  if (!isMap(providers) || !providers.has(slug)) return text;
  providers.delete(slug);
  return doc.toString();
}
