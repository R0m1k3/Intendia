import { t } from '../i18n';

/**
 * Names of the subscription cards: the brand first (Hermes names some cards after the product only, e.g. « ChatGPT
 * or Codex Subscription » for OpenAI). The Hermes name stays below when it differs.
 */
const NAMES: Record<string, string> = {
  'openai-codex': 'OpenAI — ChatGPT / Codex',
  anthropic: 'Anthropic — Claude (Pro / Max)',
  'claude-code': t('Anthropic — identifiants de Claude Code'),
  'minimax-oauth': t('MiniMax — abonnement international (minimax.io)'),
  'xai-oauth': 'xAI — Grok (SuperGrok / Premium+)',
  nous: 'Nous Portal',
  'qwen-oauth': 'Qwen — Qwen Code',
};

export function displayName(id: string, hermesName: string): { name: string; hermes: string | null } {
  const name = NAMES[id] ?? hermesName;
  return { name, hermes: name === hermesName ? null : hermesName };
}

interface Card { id: string; flow: string; connected: boolean }

/** Connectable in the browser first, then Anthropic (token pasted here), then the ones that need a terminal. */
const rank = (a: Card) => (a.flow === 'device_code' ? 0 : a.id === 'anthropic' ? 1 : 2);

/** Cards to show, in order (stable: Hermes's order within a rank). `claude-code` only when connected: the Anthropic card covers it. */
export function visibleAccounts<A extends Card>(list: readonly A[]): A[] {
  return list
    .filter((a) => a.id !== 'claude-code' || a.connected)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((x) => x.a);
}
