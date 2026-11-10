import { describe, expect, it } from 'vitest';
import { candidates, move, offered } from './chat-models-edit';

describe('chat models edition', () => {
  it('move: first up and last down change nothing', () => {
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
  it('candidates: substring without case, models already listed excluded, limit', () => {
    const cat = ['openai/gpt-5.5', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.6'];
    expect(candidates(cat, [], 'CLAUDE')).toEqual(['anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.6']);
    expect(candidates(cat, ['anthropic/claude-opus-4.6'], 'claude')).toEqual(['anthropic/claude-sonnet-4.5']);
    expect(candidates(cat, [], '')).toEqual(cat);
    expect(candidates(cat, [], '', 1)).toEqual(['openai/gpt-5.5']);
  });
  it('offered: only providers with a key, no duplicates', () => {
    expect(offered([
      { authenticated: true, models: ['a', 'b'] },
      { authenticated: false, models: ['c'] },
      { authenticated: true, models: ['b', 'd'] },
    ])).toEqual(['a', 'b', 'd']);
  });
});
