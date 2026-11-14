import { useQuery } from '@tanstack/react-query';
import { readExcalidraw, type Shape } from './excalidraw';
import { OFFICE_READ_MAX } from './office';
import { readBytes } from './read';
import { t } from '../../i18n';

function ShapeSvg({ s }: { s: Shape }) {
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const transform = s.angle ? `rotate(${(s.angle * 180) / Math.PI} ${cx} ${cy})` : undefined;
  switch (s.kind) {
    case 'rect': case 'image':
      return (
        <g transform={transform}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} stroke={s.stroke} fill={s.fill} strokeWidth={s.width} />
          {s.kind === 'image' && <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={14} fill="#6b7280">{t('image')}</text>}
        </g>
      );
    case 'ellipse':
      return <ellipse transform={transform} cx={cx} cy={cy} rx={Math.abs(s.w) / 2} ry={Math.abs(s.h) / 2} stroke={s.stroke} fill={s.fill} strokeWidth={s.width} />;
    case 'diamond':
      return <polygon transform={transform} points={`${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}`} stroke={s.stroke} fill={s.fill} strokeWidth={s.width} />;
    case 'line': case 'arrow': case 'freedraw': {
      const pts = s.points.map(([px, py]) => [s.x + px, s.y + py] as const);
      const [ax, ay] = pts[pts.length - 2]!, [bx, by] = pts[pts.length - 1]!;
      const a = Math.atan2(by - ay, bx - ax), len = 12;
      const head = `${bx - len * Math.cos(a - 0.45)},${by - len * Math.sin(a - 0.45)} ${bx},${by} ${bx - len * Math.cos(a + 0.45)},${by - len * Math.sin(a + 0.45)}`;
      return (
        <g transform={transform} fill="none" stroke={s.stroke} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round">
          <polyline points={pts.map((p) => p.join(',')).join(' ')} />
          {s.kind === 'arrow' && <polyline points={head} />}
        </g>
      );
    }
    case 'text':
      return (
        <text transform={transform} x={s.x} y={s.y} fontSize={s.size} fill={s.stroke} fontFamily="Hanken Grotesk, sans-serif">
          {s.text.split('\n').map((l, i) => <tspan key={i} x={s.x} dy={i ? s.size * 1.25 : s.size}>{l}</tspan>)}
        </text>
      );
  }
}

/** An Excalidraw drawing as SVG built by Intendia (no script, nothing from the file used as markup). */
export default function ExcalidrawView({ url, version }: { url: string; version?: number }) {
  const q = useQuery({
    queryKey: ['file-drawing', url, version],
    queryFn: async () => readExcalidraw(new TextDecoder().decode((await readBytes(url, OFFICE_READ_MAX, 'fail')).data)),
  });
  if (q.error) return <p className="p-6 text-sm text-ink-soft">{(q.error as Error).message}</p>;
  if (q.data === undefined) return null;
  if (q.data === null) return <p className="p-6 text-sm text-ink-soft">{t('Aperçu impossible : ce n’est pas un dessin Excalidraw lisible.')}</p>;
  const [x, y, w, h] = q.data.viewBox;
  return (
    <div data-viewer="excalidraw" className="flex min-h-full items-center justify-center bg-white p-4">
      <svg viewBox={`${x} ${y} ${w} ${h}`} className="max-h-[75vh] w-full" role="img" aria-label={t('Dessin Excalidraw')}>
        {q.data.shapes.map((s, i) => <ShapeSvg key={i} s={s} />)}
      </svg>
    </div>
  );
}
