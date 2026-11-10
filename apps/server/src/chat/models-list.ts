/**
 * The models of the chat's picker, per agent (instance + profile), grouped by provider. Rule chosen by Michael
 * (2026-11-10): for each provider with a key, the models declared in Hermes for it (`providers.<slug>.models` of
 * the config file); none declared = the provider's whole catalogue. Intendia keeps no list of its own.
 */
import type { z } from 'zod';
import type { ModelOptionsSchema } from '../connectors/chat/index.js';
import type { CompatReport } from '../connectors/types.js';
import type { Declared } from '../hermes-config/declared.js';

type ModelOptions = z.infer<typeof ModelOptionsSchema>;

export interface ChatGroup {
  provider: string;
  name: string;
  models: string[];
  /** The group is limited to the models declared in Hermes (false = the provider's catalogue). */
  declared: boolean;
}
export interface ChatModelList {
  auto: { model: string; provider: string | null } | null;
  groups: ChatGroup[];
  managed: boolean;
}

/** Name of one entry of a provider's `models` (a string, or an object with id / model / name). */
export function entryName(m: unknown): string | null {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const o = m as { id?: unknown; model?: unknown; name?: unknown };
    const v = o.id ?? o.model ?? o.name;
    if (typeof v === 'string') return v;
  }
  return null;
}

/**
 * Groups of the picker. `declared` = the declarations read from the file (null = file not readable, or not
 * managed: every group is the row Hermes returned, so nothing is hidden by mistake). Declared ids are kept only if
 * Hermes returned them too (it can drop an id it cannot serve), in the declared order.
 */
export function chatGroups(options: ModelOptions, declared: Map<string, Declared> | null): ChatGroup[] {
  const out: ChatGroup[] = [];
  for (const p of options.providers) {
    if (p.authenticated !== true) continue;
    const row = [...new Set((p.models ?? []).map(entryName).filter((n): n is string => Boolean(n)))];
    const d = p.is_user_defined === true ? undefined : declared?.get(p.slug);
    // spelled as Hermes returned it (it compares ids without case)
    const byLower = new Map(row.map((m) => [m.toLowerCase(), m]));
    const kept = d ? d.ids.map((m) => byLower.get(m.toLowerCase())).filter((m): m is string => Boolean(m)) : [];
    if (!row.length) continue;
    out.push({ provider: p.slug, name: p.name || p.slug, models: kept.length ? kept : row, declared: kept.length > 0 });
  }
  return out;
}

/** Main model of the agent, as Hermes reports it with the options. */
export function autoModel(options: ModelOptions): ChatModelList['auto'] {
  return options.model ? { model: options.model, provider: options.provider || null } : null;
}

/**
 * Can the declarations be managed for this instance? Same condition as the Modèles tab of the Configuration page
 * (module `config` not unavailable, operations `get` and `modelInfo` usable) plus the raw file (`raw`), where the
 * declarations are read. No report yet = true (like the web).
 */
export function chatModelsManaged(report: CompatReport | undefined): boolean {
  if (!report) return true;
  const mod = report.modules.find((m) => m.id === 'config');
  return Boolean(mod && mod.state !== 'unavailable' && mod.ops.get?.ok && mod.ops.modelInfo?.ok && mod.ops.raw?.ok);
}
