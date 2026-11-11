import { describe, expect, it } from 'vitest';
import { AUTO, changesOf, optionGroups, optionValue, parseOption, valueOf } from './aux-draft';

const tasks = [
  { task: 'vision', label: null, provider: 'auto', model: '' },
  { task: 'mcp', label: null, provider: 'openrouter', model: 'a/b' },
  { task: 'review', label: null, provider: '', model: '' },
];
const providers = [
  { slug: 'openrouter', name: 'OpenRouter', authenticated: true, keyEnv: null, models: ['a/b', 'c/d'], warning: null, declared: [], editable: true },
  { slug: 'anthropic', name: 'Anthropic', authenticated: false, keyEnv: null, models: ['x'], warning: null, declared: [], editable: true },
];

describe('aux-draft', () => {
  it('round-trips an option value', () => {
    expect(parseOption(optionValue('openrouter', 'a/b:free'))).toEqual({ provider: 'openrouter', model: 'a/b:free' });
    expect(valueOf(tasks[0]!)).toBe(AUTO);
    expect(valueOf(tasks[2]!)).toBe(AUTO);
  });
  it('counts the changed tasks; back to the original value is no change', () => {
    const draft = { vision: optionValue('openrouter', 'c/d'), mcp: AUTO, review: AUTO };
    expect(changesOf(draft, tasks)).toEqual([
      { task: 'vision', provider: 'openrouter', model: 'c/d' },
      { task: 'mcp', provider: 'auto', model: 'auto' },
    ]);
    expect(changesOf({ vision: AUTO, mcp: optionValue('openrouter', 'a/b') }, tasks)).toEqual([]);
  });
  it('groups providers with a key, keeps a current value found in none of them', () => {
    const { groups, extra } = optionGroups(providers, optionValue('anthropic', 'x'));
    expect(groups.map((g) => g.label)).toEqual(['OpenRouter']);
    expect(extra).toBe(optionValue('anthropic', 'x'));
    expect(optionGroups(providers, optionValue('openrouter', 'a/b')).extra).toBeNull();
    expect(optionGroups(providers, AUTO).extra).toBeNull();
  });
});
