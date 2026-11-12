import { describe, expect, it } from 'vitest';
import { readExcalidraw, safeColor } from './excalidraw';

const file = (elements: unknown[]) => JSON.stringify({ type: 'excalidraw', version: 2, elements });
const base = { x: 10, y: 20, width: 100, height: 50, strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, angle: 0 };

describe('excalidraw', () => {
  it('every supported type, deleted elements left out, view box = bounds + 20', () => {
    const d = readExcalidraw(file([
      { ...base, type: 'rectangle' }, { ...base, type: 'ellipse' }, { ...base, type: 'diamond' }, { ...base, type: 'image' },
      { ...base, type: 'arrow', points: [[0, 0], [100, 50]] }, { ...base, type: 'line', points: [[0, 0], [10, 0]] },
      { ...base, type: 'freedraw', points: [[0, 0], [1, 1], [2, 0]] }, { ...base, type: 'text', text: 'Bonjour', fontSize: 16 },
      { ...base, type: 'rectangle', isDeleted: true }, { ...base, type: 'frame' },
    ]))!;
    expect(d.shapes.map((s) => s.kind)).toEqual(['rect', 'ellipse', 'diamond', 'image', 'arrow', 'line', 'freedraw', 'text']);
    expect(d.viewBox).toEqual([-10, 0, 140, 90]);
  });
  it('bad colours → black, non-finite numbers → element left out, not Excalidraw → null', () => {
    const d = readExcalidraw(file([
      { ...base, type: 'rectangle', strokeColor: 'url(javascript:x)', backgroundColor: '#ff000080' },
      { ...base, type: 'rectangle', x: null }, { ...base, type: 'arrow', points: [[0, 0], [1e400, 1]] },
    ]))!;
    expect(d.shapes).toHaveLength(1);
    expect(d.shapes[0]).toMatchObject({ stroke: '#000000', fill: '#ff000080' });
    expect(safeColor('transparent')).toBe('transparent');
    expect(safeColor('red;x')).toBe('#000000');
    expect(readExcalidraw('{')).toBeNull();
    expect(readExcalidraw('{"type":"autre","elements":[]}')).toBeNull();
  });
});
