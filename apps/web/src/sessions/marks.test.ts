import { describe, expect, it } from 'vitest';
import { splitMarks } from './marks';

describe('splitMarks', () => {
  it('cuts the hit out of the text', () => {
    expect(splitMarks('a >>>b<<< c')).toEqual([{ text: 'a ', hit: false }, { text: 'b', hit: true }, { text: ' c', hit: false }]);
    expect(splitMarks('>>>x<<< et >>>y<<<').filter((p) => p.hit).map((p) => p.text)).toEqual(['x', 'y']);
  });
  it('an unclosed marker stays text', () => {
    expect(splitMarks('a >>>b')).toEqual([{ text: 'a >>>b', hit: false }]);
    expect(splitMarks('')).toEqual([]);
  });
});
