/**
 * The models offered in the chat of an agent (instance + profile): a list kept by Intendia, because Hermes
 * 0.23.0 has no list of favourite models. Stored in `settings` under `chat_models:<instance>:<profile>`
 * (JSON array of model names, in the order of the chat's picker).
 */
import { inArray, like, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { ModelOptionsSchema } from '../connectors/chat/index.js';
import type { CompatReport } from '../connectors/types.js';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';

export const CHAT_MODELS_MAX = 50;
type ModelOptions = z.infer<typeof ModelOptionsSchema>;

const key = (inst: string, profile: string) => `chat_models:${inst}:${profile}`;

/** Name of one entry of a provider's `models` (a string, or an object with id / model / name). */
function entryName(m: unknown): string | null {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const o = m as { id?: unknown; model?: unknown; name?: unknown };
    const v = o.id ?? o.model ?? o.name;
    if (typeof v === 'string') return v;
  }
  return null;
}

/**
 * Models Hermes offers to this agent. Rule shared with the web (config/chat-models-edit.ts `offered`): a model is
 * offered if it is in the `models` of a provider whose `authenticated` is true (missing = false, like
 * ConfigService.models()). The main model (`model`) is not added: the chat shows it as "Auto".
 */
export function offeredModels(options: ModelOptions): string[] {
  const out = new Set<string>();
  for (const p of options.providers) {
    if (p.authenticated !== true) continue;
    for (const m of p.models ?? []) {
      const n = entryName(m);
      if (n) out.add(n);
    }
  }
  return [...out];
}

export function readChatModels(db: Db, inst: string, profile: string): string[] {
  const row = db.select().from(settings).where(eq(settings.key, key(inst, profile))).get();
  if (!row) return [];
  try {
    const v = JSON.parse(row.value) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : [];
  } catch {
    return [];
  }
}

export function writeChatModels(db: Db, inst: string, profile: string, models: string[]): void {
  const value = JSON.stringify(models);
  db.insert(settings).values({ key: key(inst, profile), value })
    .onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** Called when an instance is removed: drops the lists of all its agents. */
export function forgetChatModels(db: Db, inst: string): void {
  const prefix = `chat_models:${inst}:`;
  // `_` is a LIKE wildcard: filter the rows by their exact prefix before deleting.
  const keys = db.select({ key: settings.key }).from(settings).where(like(settings.key, 'chat_models:%')).all()
    .map((r) => r.key).filter((k) => k.startsWith(prefix));
  if (keys.length) db.delete(settings).where(inArray(settings.key, keys)).run();
}

/**
 * Can the list be managed for this instance? Same condition as the Modèles tab of the Configuration page:
 * module `config` not unavailable, operations `get` and `modelInfo` usable. No report yet = true (like the web).
 */
export function chatModelsManaged(report: CompatReport | undefined): boolean {
  if (!report) return true;
  const mod = report.modules.find((m) => m.id === 'config');
  return Boolean(mod && mod.state !== 'unavailable' && mod.ops.get?.ok && mod.ops.modelInfo?.ok);
}
