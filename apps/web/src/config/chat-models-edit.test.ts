import { describe, expect, it } from 'vitest';
import { addChoices, validModelName } from './chat-models-edit';

const CAT = ['openai/gpt-5.5', 'openai/gpt-5.5-mini', 'qwen/qwen3-coder'];

describe('addChoices', () => {
  it('filters the catalogue by the typed text, without the declared models (any case)', () => {
    expect(addChoices(CAT, ['OpenAI/GPT-5.5'], 'gpt').filter((c) => !c.typed).map((c) => c.model)).toEqual(['openai/gpt-5.5-mini']);
    expect(addChoices(CAT, [], '').map((c) => c.model)).toEqual(CAT);
    expect(addChoices(CAT, [], '', 2)).toHaveLength(2);
  });
  it('offers the typed name itself when valid and new', () => {
    expect(addChoices(CAT, [], 'my/own-model').at(-1)).toEqual({ model: 'my/own-model', typed: true });
    expect(addChoices(CAT, [], 'qwen/qwen3-coder').filter((c) => c.typed)).toEqual([]);
    expect(addChoices(CAT, ['my/own'], 'MY/OWN').filter((c) => c.typed)).toEqual([]);
    expect(addChoices(CAT, [], 'bad name').filter((c) => c.typed)).toEqual([]);
  });
  it('validModelName follows the server rule', () => {
    expect(validModelName(' a/b ')).toBe(true);
    expect(validModelName('')).toBe(false);
    expect(validModelName('a b')).toBe(false);
    expect(validModelName('x'.repeat(201))).toBe(false);
  });
});
