import { describe, expect, it } from 'vitest';
import { insertAt } from './insert';

describe('insertAt', () => {
  it('spaces before and after when needed', () => {
    expect(insertAt('Lis puis résume', 3, 3, '/w/a.md')).toEqual({ value: 'Lis /w/a.md puis résume', caret: 11 });
    expect(insertAt('Lis \nsuite', 4, 4, 'x')).toEqual({ value: 'Lis x\nsuite', caret: 5 });
  });
  it('a selection is replaced; at the end a space follows; empty field → the text alone', () => {
    expect(insertAt('Lis CECI stp', 4, 8, 'x')).toEqual({ value: 'Lis x stp', caret: 5 });
    expect(insertAt('Lis', 3, 3, 'x')).toEqual({ value: 'Lis x ', caret: 6 });
    expect(insertAt('', 0, 0, 'x')).toEqual({ value: 'x', caret: 1 });
  });
});
