import { describe, expect, it } from 'vitest';
import type { ChatModelList } from '../api';
import { currentValue, decodeChoice, encodeChoice, modelItems } from './model-items';
import { pickerGroups } from '../components/Menu';

const noop = () => {};
const none = { model: null, provider: null };
const text = (l: ChatModelList | undefined, cur: { model: string | null; provider: string | null } = none) =>
  modelItems(l, cur, noop).map((i) => ('heading' in i ? `# ${i.heading}` : i.label));
const LIST: ChatModelList = {
  auto: { model: 'anthropic/claude-opus-4.6', provider: 'openrouter' },
  groups: [
    { provider: 'openrouter', name: 'OpenRouter', models: ['a', 'b'], declared: true },
    { provider: 'anthropic', name: 'Anthropic', models: ['c'], declared: false },
  ],
  managed: true,
};

describe('modelItems', () => {
  it('no list yet: Auto only', () => {
    expect(text(undefined)).toEqual(['Auto']);
  });
  it('Auto, one titled group per provider, then the manage action', () => {
    expect(text(LIST)).toEqual(['Auto · claude-opus-4.6', '# OpenRouter', 'a', 'b', '# Anthropic', 'c', 'Gérer les modèles…']);
    const choice = modelItems(LIST, none, noop)[2]!;
    expect('value' in choice && decodeChoice(choice.value)).toEqual({ model: 'a', provider: 'openrouter' });
  });
  it('a session model without provider that is in a group is not repeated; otherwise under "Autre"', () => {
    expect(text(LIST, { model: 'c', provider: null })).not.toContain('# Autre');
    expect(text(LIST, { model: 'z', provider: null })).toEqual([...text(LIST).slice(0, -1), '# Autre', 'z', 'Gérer les modèles…']);
  });
  it('a model with a provider no longer offered is "indisponible" under "Autre"', () => {
    const items = modelItems(LIST, { model: 'gone', provider: 'openrouter' }, noop);
    const gone = items.find((i) => 'value' in i && i.label === 'gone')!;
    expect('hint' in gone && gone.hint).toBe('openrouter · indisponible');
    expect(text(LIST, { model: 'c', provider: 'openrouter' })).toContain('# Autre');
  });
  it('the manage action only when managed', () => {
    expect(text({ ...LIST, managed: false }).at(-1)).toBe('c');
    const action = modelItems(LIST, none, noop).at(-1)!;
    expect('action' in action && action.action).toBe(noop);
  });
  it('encodes and decodes choices; current value', () => {
    expect(decodeChoice(encodeChoice('llama3:8b', 'custom:local'))).toEqual({ model: 'llama3:8b', provider: 'custom:local' });
    expect(decodeChoice('m')).toEqual({ model: 'm', provider: null });
    expect(decodeChoice(null)).toEqual(none);
    expect(currentValue(LIST, { model: 'c', provider: null })).toBe(encodeChoice('c', 'anthropic'));
    expect(currentValue(LIST, { model: 'z', provider: null })).toBe('z');
    expect(currentValue(LIST, none)).toBeNull();
  });
});

describe('picker groups', () => {
  it('folds each provider group and leaves Auto and the actions outside', () => {
    const l = { auto: null, managed: true, groups: [{ provider: 'a', name: 'A', models: ['m1', 'm2'] }, { provider: 'b', name: 'B', models: ['m3'] }] } as unknown as ChatModelList;
    const items = modelItems(l, { model: null, provider: null }, noop);
    expect(items.filter((i) => 'heading' in i).every((i) => 'heading' in i && i.collapsible)).toBe(true);
    expect(pickerGroups(items)).toEqual([-1, -1, 1, 1, -1, 4, -1]);
  });
});
