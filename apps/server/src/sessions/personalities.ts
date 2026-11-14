// Personality of a session (option 9): one of the profile's config (`hermes:<name>`) or one written in Intendia
// (`intendia:<prompt id>`, table prompts). Hermes applies its own only through `/personality` of its chat (no HTTP
// route), so Intendia adds the text to the instructions of each run.
import { msg } from '../i18n/index.js';
import type { ConfigService } from '../hermes-config/service.js';
import type { PromptService } from '../prompts/service.js';

export const PERSONALITY_RE = /^(hermes:[A-Za-z0-9_.-]{1,64}|intendia:[0-9a-f-]{36})$/;

export interface PersonalityItem { value: string; label: string; source: 'hermes' | 'intendia' }

/** Hermes' rendering: a text, or the system prompt then « Tone: » and « Style: » lines. */
export function renderPersonality(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const parts = [
    typeof o.system_prompt === 'string' ? o.system_prompt.trim() : '',
    typeof o.tone === 'string' && o.tone.trim() ? `Tone: ${o.tone.trim()}` : '',
    typeof o.style === 'string' && o.style.trim() ? `Style: ${o.style.trim()}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('\n') : null;
}

export async function listPersonalities(
  config: ConfigService, prompts: PromptService, instanceId: string, profile: string,
): Promise<{ items: PersonalityItem[]; error?: string }> {
  const own = prompts.list('personality').map((p): PersonalityItem => ({ value: `intendia:${p.id}`, label: p.title, source: 'intendia' }));
  try {
    const all = await config.personalities(instanceId, profile);
    const hermes = Object.entries(all).filter(([, v]) => renderPersonality(v))
      .map(([name]): PersonalityItem => ({ value: `hermes:${name}`, label: name, source: 'hermes' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return { items: [...hermes, ...own] };
  } catch (err) {
    return { items: own, error: msg('Personnalités de l’agent illisibles : {why}', { why: (err as Error).message }) };
  }
}

/** Text of a personality, or why it is left out (the run goes on without it). */
export async function resolvePersonality(
  config: ConfigService, prompts: PromptService, instanceId: string, profile: string, value: string,
): Promise<{ label: string; text: string } | { notice: string }> {
  const [kind, name] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
  if (kind === 'intendia') {
    const p = prompts.list('personality').find((x) => x.id === name);
    return p ? { label: p.title, text: p.body } : { notice: msg('Personnalité introuvable dans Intendia : ignorée') };
  }
  let all: Record<string, unknown>;
  try {
    all = await config.personalities(instanceId, profile);
  } catch {
    return { notice: msg('Personnalités de l’agent illisibles : ignorée') };
  }
  const text = renderPersonality(all[name]);
  return text ? { label: name, text } : { notice: msg('Personnalité {name} introuvable chez l’agent : ignorée', { name }) };
}

/** Whether a `hermes:<name>` personality exists at a profile (copy to another profile); intendia ones always do. */
export async function personalityExists(config: ConfigService, instanceId: string, profile: string, value: string): Promise<boolean> {
  if (!value.startsWith('hermes:')) return true;
  try {
    return renderPersonality((await config.personalities(instanceId, profile))[value.slice(7)]) !== null;
  } catch {
    return false;
  }
}
