import { describe, expect, it } from 'vitest';
import { changeList, editorKind, fromText, isMasked, reapply, toText } from './fields';

describe('editorKind', () => {
  it('follows the schema type, the value for loose strings, and protects masked values', () => {
    expect(editorKind({ type: 'boolean' }, true)).toBe('boolean');
    expect(editorKind({ type: 'string' }, 500)).toBe('number');
    expect(editorKind({ type: 'string' }, 'x')).toBe('text');
    expect(editorKind({ type: 'list' }, ['a', 1])).toBe('lines');
    expect(editorKind({ type: 'list' }, [{ a: 1 }])).toBe('readonly');
    expect(editorKind({ type: 'object' }, {})).toBe('readonly');
    expect(editorKind({ type: 'string' }, '«secret:0123abcd»')).toBe('readonly');
    expect(isMasked('https://h/?k=«secret:0123abcd»')).toBe(true);
  });
});

describe('toText / fromText', () => {
  it('converts per type', () => {
    expect(fromText('number', '42', 1)).toEqual({ ok: true, value: 42 });
    expect(fromText('number', 'abc', 1).ok).toBe(false);
    expect(fromText('number', '', 1).ok).toBe(false);
    expect(toText('lines', ['a', 'b'])).toBe('a\nb');
    expect(fromText('lines', 'a\n\n b \n', ['x'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(fromText('lines', '1\n2', [3])).toEqual({ ok: true, value: [1, 2] });
    expect(fromText('text', '12', null)).toEqual({ ok: true, value: 12 });
    expect(fromText('text', '12', 'old')).toEqual({ ok: true, value: '12' });
  });
});

describe('changeList / reapply', () => {
  it('drops an edit back to the start value', () => {
    const values = { 'a.b': 1, 'a.c': true };
    expect(changeList(values, { 'a.b': 1, 'a.c': false })).toEqual([{ path: 'a.c', before: true, after: false }]);
  });

  it('re-applies pending edits on fresh values and reports paths gone from the schema', () => {
    const r = reapply({ 'a.b': 2, 'gone.x': 1 }, { 'a.b': { type: 'number' } });
    expect(r).toEqual({ kept: { 'a.b': 2 }, dropped: ['gone.x'] });
  });
});
