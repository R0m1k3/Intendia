import { describe, expect, it } from 'vitest';
import { chatGroups } from '../src/chat/models-list.js';
import { declaredIds, declaredModels, editableShape } from '../src/hermes-config/declared.js';

describe('models declared per provider', () => {
  it('reads every shape like Hermes _declared_model_ids', () => {
    expect(declaredIds('a/b')).toEqual(['a/b']);
    expect(declaredIds(['a/b', ' c ', 'A/B', '', 3])).toEqual(['a/b', 'c']);
    expect(declaredIds([{ id: 'a' }, { id: ' ', name: 'b' }, { name: 'c' }])).toEqual(['a', 'b', 'c']);
    expect(declaredIds({ a: {}, __explicit_model_allowlist__: true, __discovered_model_catalog__: true })).toEqual(['a']);
    expect(declaredIds(null)).toEqual([]);
  });

  it('shape and custom flag per entry; unparsable text = no entry', () => {
    const m = declaredModels(`providers:
  openrouter:
    models: [a/b]
  one: {models: a}
  objs:
    models: [{id: a}]
  dict:
    models: {a: {}}
  none: {api_key: x}
  local:
    base_url: http://localhost/v1
    models: [m]
`);
    expect(Object.fromEntries([...m].map(([k, v]) => [k, v.shape]))).toEqual({ openrouter: 'strings', one: 'string', objs: 'objects', dict: 'dict', none: 'none', local: 'strings' });
    expect(m.get('local')!.custom).toBe(true);
    expect(m.get('openrouter')!.custom).toBe(false);
    expect(['strings', 'string', 'none'].every((s) => editableShape(s as never))).toBe(true);
    expect(editableShape('dict') || editableShape('objects')).toBe(false);
    expect(declaredModels(': : :\n  - [').size).toBe(0);
  });

  it('chat groups: declared ∩ returned row, in declared order; empty → catalogue; no key or no models → no group', () => {
    const options = {
      providers: [
        { slug: 'or', name: 'OpenRouter', authenticated: true, models: ['x', 'y', 'z'] },
        { slug: 'nokey', name: 'No key', models: ['q'] },
        { slug: 'empty', authenticated: true, models: [] },
        { slug: 'mine', name: 'Mine', authenticated: true, is_user_defined: true, models: ['m1'] },
      ],
    };
    const declared = declaredModels('providers:\n  or:\n    models: [z, gone, X]\n  mine:\n    models: [other]\n');
    expect(chatGroups(options, declared)).toEqual([
      { provider: 'or', name: 'OpenRouter', models: ['z', 'x'], declared: true },
      { provider: 'mine', name: 'Mine', models: ['m1'], declared: false },
    ]);
    expect(chatGroups(options, declaredModels('providers:\n  or:\n    models: [gone]\n'))[0]).toMatchObject({ models: ['x', 'y', 'z'], declared: false });
    expect(chatGroups(options, null)[0]!.declared).toBe(false);
  });
});
