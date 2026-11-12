import { useState } from 'react';
import type { UsageDay } from '../api';
import { formatTokens, formatUsd, niceScale } from './format';

const H = 160;
const PAD_L = 52;
const PAD_B = 22;
const PAD_T = 10;
const GAP = 2;

/** "2026-11-12" → "12/11". */
const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Local calendar day "YYYY-MM-DD". */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Every day of the period ending today, the missing ones at 0 (Hermes leaves out days without sessions). The end is
 * today, or the last returned day when Hermes' clock is already on the next day.
 */
export function fillDays(daily: UsageDay[], days: number, today = new Date()): UsageDay[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const lastDay = daily.map((d) => d.day).sort().at(-1);
  const todayDay = localDay(today);
  const end = lastDay && lastDay > todayDay ? lastDay : todayDay;
  const last = new Date(`${end}T12:00:00Z`);
  const out: UsageDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(last.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, estimatedCost: 0, actualCost: 0, input: 0, output: 0, sessions: 0, apiCalls: 0 });
  }
  return out;
}

/** Estimated cost per day: one series, accent bars, recessive grid, per-bar tooltip; table view next to it. */
export function DailyBars({ daily, days }: { daily: UsageDay[]; days: number }) {
  const data = fillDays(daily, days);
  const [hover, setHover] = useState<number | null>(null);
  const { top, ticks } = niceScale(Math.max(0, ...data.map((d) => d.estimatedCost ?? 0)));
  const W = 720;
  const slot = (W - PAD_L) / data.length;
  const bw = Math.max(2, slot - GAP);
  const y = (v: number) => H - (v / top) * H;
  const every = Math.ceil(data.length / 8);
  const h = hover === null ? null : data[hover]!;
  return (
    <div className="relative">
      <svg viewBox={`0 ${-PAD_T} ${W} ${H + PAD_B + PAD_T}`} className="w-full" role="img" aria-label="Coût estimé par jour" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-faint text-[11px]">{formatUsd(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = d.estimatedCost ?? 0;
          const x = PAD_L + i * slot + GAP / 2;
          const bh = v > 0 ? Math.max(2, H - y(v)) : 0;
          const r = Math.min(4, bw / 2, bh);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              {/* hit target: the whole column */}
              <rect x={PAD_L + i * slot} y={0} width={slot} height={H} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x},${H} v${-(bh - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${bh - r} z`}
                  fill="var(--color-accent)" opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % every === 0 && <text x={x + bw / 2} y={H + 15} textAnchor="middle" className="fill-ink-faint text-[11px]">{short(d.day)}</text>}
            </g>
          );
        })}
      </svg>
      {h && (
        <div role="tooltip" className="pointer-events-none absolute top-0 rounded-lg border border-line bg-sheet px-3 py-2 text-xs shadow-sm"
          style={{ left: `min(calc(${((PAD_L + (hover! + 0.5) * slot) / W) * 100}% + 8px), calc(100% - 11rem))` }}>
          <p className="font-medium">{h.day}</p>
          <p className="text-ink-soft">Coût estimé : <span className="font-mono text-ink">{formatUsd(h.estimatedCost)}</span></p>
          <p className="text-ink-soft">Sessions : <span className="font-mono text-ink">{h.sessions ?? '—'}</span> · appels : <span className="font-mono text-ink">{h.apiCalls ?? '—'}</span></p>
          <p className="text-ink-soft">Jetons : <span className="font-mono text-ink">{formatTokens(h.input)}</span> / <span className="font-mono text-ink">{formatTokens(h.output)}</span></p>
        </div>
      )}
    </div>
  );
}
