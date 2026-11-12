/**
 * Excalidraw drawing → shapes already checked (finite numbers, allowed colours), drawn as SVG by ExcalidrawView.
 * Supported: rectangle, ellipse, diamond, line / arrow, freedraw, text, image (grey frame); rotation.
 */
export type Shape =
  | { kind: 'rect' | 'ellipse' | 'diamond' | 'image'; x: number; y: number; w: number; h: number; stroke: string; fill: string; width: number; angle: number }
  | { kind: 'line' | 'arrow' | 'freedraw'; x: number; y: number; w: number; h: number; points: [number, number][]; stroke: string; width: number; angle: number }
  | { kind: 'text'; x: number; y: number; w: number; h: number; text: string; size: number; stroke: string; angle: number };

export interface Drawing { shapes: Shape[]; viewBox: [number, number, number, number] }

const NAMED = /^[a-z]+$/i;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `transparent` or a colour name; anything else → black. */
export function safeColor(c: unknown, fallback = '#000000'): string {
  return typeof c === 'string' && (HEX.test(c) || NAMED.test(c)) ? c : fallback;
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function shape(e: Record<string, unknown>): Shape | null {
  const x = num(e.x), y = num(e.y), w = num(e.width ?? 0), h = num(e.height ?? 0), angle = num(e.angle ?? 0), width = num(e.strokeWidth ?? 1);
  if (x === null || y === null || w === null || h === null || angle === null || width === null) return null;
  const stroke = safeColor(e.strokeColor);
  const fill = safeColor(e.backgroundColor, 'transparent');
  switch (e.type) {
    case 'rectangle': return { kind: 'rect', x, y, w, h, stroke, fill, width, angle };
    case 'ellipse': return { kind: 'ellipse', x, y, w, h, stroke, fill, width, angle };
    case 'diamond': return { kind: 'diamond', x, y, w, h, stroke, fill, width, angle };
    case 'image': return { kind: 'image', x, y, w, h, stroke: '#9ca3af', fill: '#f3f4f6', width: 1, angle };
    case 'line': case 'arrow': case 'freedraw': {
      if (!Array.isArray(e.points)) return null;
      const points: [number, number][] = [];
      for (const p of e.points) {
        const px = Array.isArray(p) ? num(p[0]) : null, py = Array.isArray(p) ? num(p[1]) : null;
        if (px === null || py === null) return null;
        points.push([px, py]);
      }
      if (points.length < 2) return null;
      return { kind: e.type === 'arrow' ? 'arrow' : e.type === 'freedraw' ? 'freedraw' : 'line', x, y, w, h, points, stroke, width, angle };
    }
    case 'text': {
      const size = num(e.fontSize ?? 20);
      if (typeof e.text !== 'string' || size === null) return null;
      return { kind: 'text', x, y, w, h, text: e.text, size, stroke, angle };
    }
    default: return null;
  }
}

/** JSON text → drawing; null when it is not an Excalidraw file. */
export function readExcalidraw(text: string): Drawing | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'excalidraw') return null;
  const elements = (data as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return null;
  const shapes = elements
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !(e as { isDeleted?: unknown }).isDeleted)
    .map(shape).filter((s): s is Shape => s !== null);
  if (!shapes.length) return { shapes, viewBox: [0, 0, 100, 100] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (px: number, py: number) => { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); };
  for (const s of shapes) {
    // the same rotation as the drawing: around the centre of the element's box
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, cos = Math.cos(s.angle), sin = Math.sin(s.angle);
    const turned = (px: number, py: number) => take(cx + (px - cx) * cos - (py - cy) * sin, cy + (px - cx) * sin + (py - cy) * cos);
    if ('points' in s) for (const [px, py] of s.points) turned(s.x + px, s.y + py);
    else for (const [px, py] of [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]] as const) turned(px, py);
  }
  return { shapes, viewBox: [minX - 20, minY - 20, maxX - minX + 40, maxY - minY + 40] };
}
