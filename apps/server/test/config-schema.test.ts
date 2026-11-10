import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/hermes-config/mask.js';
import { checkValue, flatten, unflatten, validateDoc, type Fields } from '../src/hermes-config/schema.js';
import { FIXTURES } from './helpers.js';

const fields: Fields = {
  'agent.max_turns': { type: 'number' },
  'agent.mode': { type: 'select', options: ['a', 'b'], clearable: true },
  'agent.strict': { type: 'select', options: ['x'] },
  'display.compact': { type: 'boolean' },
  toolsets: { type: 'list' },
  'terminal.env': { type: 'object' },
  model: { type: 'string' },
};

describe('flatten / unflatten', () => {
  it('stops on schema leaves and never walks lists', () => {
    const obj = { agent: { max_turns: 3, extra: { x: 1 } }, toolsets: ['a'], terminal: { env: { A: '1' } }, display: { compact: false } };
    const flat = flatten(obj, fields);
    expect(flat).toEqual({ 'agent.max_turns': 3, toolsets: ['a'], 'terminal.env': { A: '1' }, 'display.compact': false });
    expect(flatten(unflatten(flat), fields)).toEqual(flat);
  });
});

describe('checkValue', () => {
  it('checks each type', () => {
    expect(checkValue(fields['agent.max_turns']!, 3)).toBeNull();
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, '3']) expect(checkValue(fields['agent.max_turns']!, v)).not.toBeNull();
    expect(checkValue(fields['agent.mode']!, 'a')).toBeNull();
    expect(checkValue(fields['agent.mode']!, '')).toBeNull();
    expect(checkValue(fields['agent.strict']!, '')).not.toBeNull();
    expect(checkValue(fields['agent.mode']!, 'z')).not.toBeNull();
    expect(checkValue(fields.toolsets!, ['a', 2])).toBeNull();
    expect(checkValue(fields.toolsets!, [{ a: 1 }])).not.toBeNull();
    expect(checkValue(fields['display.compact']!, null)).not.toBeNull();
    expect(checkValue(fields['display.compact']!, null, { allowNull: true })).toBeNull();
  });
});

describe('validateDoc', () => {
  it('ignores paths absent from the schema, model tables and accepts null', () => {
    expect(validateDoc({ model: { default: 'x' }, mcp_servers: { a: { url: 1 } }, display: { compact: null } }, fields)).toEqual([]);
    expect(validateDoc({ agent: { max_turns: 'abc' } }, fields)).toEqual(['agent.max_turns']);
  });

  it('accepts the real config file of the reference instance', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'dash', 'GET_api_config_raw.json'), 'utf8')) as { body: { yaml: string } };
    const schema = JSON.parse(readFileSync(join(FIXTURES, 'dash', 'GET_api_config_schema.json'), 'utf8')) as { body: { fields: Fields } };
    expect(validateDoc(parse(raw.body.yaml).toJS(), schema.body.fields)).toEqual([]);
  });
});
