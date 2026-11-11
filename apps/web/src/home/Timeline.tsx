import { Link } from '@tanstack/react-router';
import type { OverviewCron } from '../api';
import { useNow } from '../components/useNow';
import { useStoredFlag } from '../components/useStoredFlag';
import { cx } from '../components/ui';
import { describe } from '../crons/schedule';
import { DAY_MIN, dayStart, hhmm, occurrences, offsetMinutes } from '../crons/timeline';
import { FAILED } from './summary';
import { Toggle } from './Toggle';

const MOBILE_ROWS = 10;

const pct = (m: number) => `${(m / DAY_MIN) * 100}%`;
const fmtOffset = (off: number) => {
  const a = Math.abs(off);
  return `UTC${off < 0 ? '−' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

/** Hermes's offset for an instance: the next run of its first cron without its own zone, else of its first cron. */
function axisOf(crons: OverviewCron[]): number {
  const plain = crons.find((c) => !c.timezone && offsetMinutes(c.nextRunAt) !== null) ?? crons.find((c) => offsetMinutes(c.nextRunAt) !== null);
  return offsetMinutes(plain?.nextRunAt) ?? -new Date().getTimezoneOffset();
}

/** One line of the timeline: a band (more than 288 runs), a stroke per run (25 to 288) or a dot (24 or fewer). */
function Track({ runs, nowMin, last }: { runs: number[]; nowMin: number; last: { min: number; failed: boolean } | null }) {
  const past = (m: number) => m <= nowMin;
  let marks: React.ReactNode;
  if (runs.length > 288) {
    const lo = runs[0]!;
    const hi = runs.at(-1)! + 1;
    const mid = Math.min(Math.max(nowMin, lo), hi);
    marks = (
      <>
        {mid > lo && <rect x={pct(lo)} y="7" width={pct(mid - lo)} height="6" rx="1" className="fill-ink-soft" />}
        {hi > mid && <rect x={pct(mid)} y="7" width={pct(hi - mid)} height="6" rx="1" className="fill-line" />}
      </>
    );
  } else if (runs.length > 24) {
    marks = runs.map((m) => <line key={m} x1={pct(m)} x2={pct(m)} y1="5" y2="15" strokeWidth="1.25" className={past(m) ? 'stroke-ink-soft' : 'stroke-line'} />);
  } else {
    marks = runs.map((m) => <circle key={m} cx={pct(m)} cy="10" r="3.5" className={past(m) ? 'fill-ink-soft' : 'fill-sheet stroke-ink-faint'} strokeWidth="1.25" />);
  }
  return (
    <svg className="h-5 w-full overflow-visible" aria-hidden>
      <line x1="0" x2="100%" y1="10" y2="10" strokeWidth="1" className="stroke-line" strokeDasharray="2 3" />
      {marks}
      {last && (
        <circle data-last-run={last.failed ? 'failed' : 'ok'} cx={pct(last.min)} cy="10" r="5" strokeWidth="2"
          className={last.failed ? 'fill-bad stroke-sheet' : 'fill-accent stroke-sheet'} />
      )}
      <line x1={pct(nowMin)} x2={pct(nowMin)} y1="0" y2="20" strokeWidth="1.5" className="stroke-accent" />
    </svg>
  );
}

function InstanceTimeline({ label, crons, now, many, open }: { label: string | null; crons: OverviewCron[]; now: number; many: boolean; open: boolean }) {
  const axis = axisOf(crons);
  const start = dayStart(now, axis);
  const nowMin = Math.floor((now - start) / 60_000);
  const rows = crons.map((c) => {
    const runs = occurrences(c, start, axis);
    const lastAt = c.lastRunAt ? Date.parse(c.lastRunAt) : Number.NaN;
    const lastMin = Math.floor((lastAt - start) / 60_000);
    const last = lastMin >= 0 && lastMin < DAY_MIN ? { min: lastMin, failed: FAILED.has(c.lastStatus ?? '') } : null;
    return { c, runs, last };
  });
  const total = rows.reduce((n, r) => n + (r.runs?.length ?? 0), 0);
  const browser = -new Date(now).getTimezoneOffset();
  return (
    <div className={cx(many && 'border-t border-line pt-3')}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-soft">
        {label && <span className="font-medium text-ink">{label}</span>}
        <span data-timeline-count>{plural(crons.length, 'cron', 'crons')} · {plural(total, 'exécution', 'exécutions')} par jour</span>
        {axis !== browser && <span className="text-xs text-ink-faint">heure d’Hermes, {fmtOffset(axis)}</span>}
      </p>
      {open && (<>
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2.5 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <div className="hidden md:block" />
          <div className="relative hidden h-4 font-mono text-[10px] text-ink-faint md:block" aria-hidden>
            {[0, 6, 12, 18, 24].map((h) => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h * 60) }}>{String(h).padStart(2, '0')}</span>
            ))}
          </div>
          {rows.map(({ c, runs, last }, i) => {
            const next = runs?.find((m) => m > nowMin);
            const title = runs === null
              ? 'Horaire non lisible'
              : `${plural(runs.length, 'exécution', 'exécutions')} aujourd’hui${next !== undefined ? `, prochaine à ${hhmm(next)}` : ''}${last ? `, dernier run à ${hhmm(last.min)}${last.failed ? ' (échec)' : ''}` : ''}`;
            return (
              <div key={`${c.instanceId}/${c.id}`} data-timeline-row className="contents">
                <div className={cx('min-w-0', i >= MOBILE_ROWS && 'max-md:hidden')}>
                  <p className="truncate text-[13px] font-medium">{c.name}</p>
                  <p className="truncate text-xs text-ink-faint">{describe(c.schedule)}</p>
                </div>
                <div className={cx('flex min-w-0 items-center', i >= MOBILE_ROWS && 'max-md:hidden')} title={title}>
                  {runs === null ? <span className="text-xs text-ink-faint">horaire non lisible</span> : <Track runs={runs} nowMin={nowMin} last={last} />}
                  <span className="sr-only">{title}</span>
                </div>
              </div>
            );
          })}
        </div>
        {rows.length > MOBILE_ROWS && (
          <Link to="/crons" className="mt-3 block text-[13px] font-medium text-accent-ink hover:underline md:hidden">
            et {rows.length - MOBILE_ROWS} autres
          </Link>
        )}
      </>)}
    </div>
  );
}

/** "Aujourd'hui": the runs of the day of every active cron, past dark, to come light, in Hermes's time. */
export function CronTimeline({ crons }: { crons: OverviewCron[] }) {
  const now = useNow(60_000);
  const [open, setOpen] = useStoredFlag('intendia-home-timeline-open');
  if (crons.length === 0) return null;
  const byInstance = new Map<string, OverviewCron[]>();
  for (const c of crons) byInstance.set(c.instanceId, [...(byInstance.get(c.instanceId) ?? []), c]);
  const many = byInstance.size > 1;
  return (
    <section className="card px-4 py-3" aria-labelledby="timeline-title" data-collapsed={open ? undefined : ''}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 id="timeline-title" className="text-[15px] font-semibold">Aujourd’hui</h2>
          <Toggle open={open} onToggle={() => setOpen(!open)} controls="timeline-body" />
        </div>
        {open && <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint" aria-label="Légende">
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-soft" />Passé</li>
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full border border-ink-faint" />À venir</li>
            <li className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-accent" />Maintenant</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" />Dernier run</li>
        </ul>}
      </header>
      <div id="timeline-body" className={cx(open ? 'mt-3 space-y-4' : 'mt-2 space-y-2')}>
        {[...byInstance.values()].map((list) => (
          <InstanceTimeline key={list[0]!.instanceId} label={many ? list[0]!.instanceLabel : null} crons={list} now={now} many={many && open} open={open} />
        ))}
      </div>
    </section>
  );
}
