import { describe, expect, it } from 'vitest';
import { changed, diffLines, hunks } from './diff';

describe('diffLines', () => {
  it('finds additions, deletions and modifications', () => {
    const d = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(d.filter((l) => l.kind !== 'same')).toEqual([
      { kind: 'del', text: 'b' }, { kind: 'add', text: 'B' }, { kind: 'add', text: 'e' },
    ]);
    expect(changed(diffLines('x\ny', 'y'))).toBe(1);
  });

  it('returns only unchanged lines for identical texts', () => {
    expect(changed(diffLines('a\nb\n', 'a\nb\n'))).toBe(0);
  });

  it('handles a last line without line break', () => {
    expect(diffLines('a\nb', 'a\nb\n').filter((l) => l.kind !== 'same')).toEqual([{ kind: 'add', text: '' }]);
  });

  it('groups changes with context and skips long unchanged runs', () => {
    const before = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l15', 'L15');
    const h = hunks(diffLines(before, after), 2);
    expect(h[0]).toEqual({ skipped: 13 });
    expect(h[1]).toMatchObject({ start: 14 });
    expect((h[1] as { lines: unknown[] }).lines).toHaveLength(6);
    expect(h[2]).toEqual({ skipped: 12 });
  });
});
