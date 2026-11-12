import type { Entry } from './events';

/**
 * Rough context used by the thread: characters / 4 of what the page shows (messages, reasoning, tool calls and
 * results). Without the system prompt nor the tool definitions: an underestimate, always shown with « ≈ ».
 */
export function estimateTokens(entries: Entry[]): number {
  let chars = 0;
  for (const e of entries) {
    if (e.kind === 'user' || e.kind === 'assistant' || e.kind === 'reasoning' || e.kind === 'delegation') chars += e.text.length;
    else if (e.kind === 'tool') chars += e.preview.length + (e.result?.length ?? 0);
  }
  return Math.ceil(chars / 4);
}
