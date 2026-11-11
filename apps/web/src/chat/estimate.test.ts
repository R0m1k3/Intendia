import { describe, expect, it } from 'vitest';
import { estimateTokens } from './estimate';
import type { Entry } from './events';

describe('estimateTokens', () => {
  it('counts the text of messages, reasoning and tools, four characters a token', () => {
    const entries: Entry[] = [
      { kind: 'user', key: 'u', text: 'x'.repeat(40), ts: null },
      { kind: 'assistant', key: 'a', text: 'x'.repeat(20), ts: null },
      { kind: 'reasoning', key: 'r', text: 'x'.repeat(10), ts: null },
      { kind: 'tool', key: 't', callId: null, tool: 'terminal', preview: 'ls', result: 'x'.repeat(8), duration: null, state: 'ok', ts: null },
      { kind: 'note', key: 'n', text: 'ignorée', tone: 'muted', ts: null },
    ];
    expect(estimateTokens(entries)).toBe(Math.ceil(80 / 4));
    expect(estimateTokens([])).toBe(0);
  });
});
