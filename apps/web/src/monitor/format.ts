// Number formats of the Suivi page (French locale, "—" for a value Hermes did not give).

const DASH = '—';
const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat('fr-FR', opts);

/** 1234 → "1 234", 1 234 567 → "1,2 M". */
export function formatTokens(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  if (Math.abs(v) >= 1e6) return `${nf({ maximumFractionDigits: 1 }).format(v / 1e6)} M`;
  return nf({ maximumFractionDigits: 0 }).format(v);
}

/** US dollars: 4 decimals below one cent, else 2. */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const digits = v !== 0 && Math.abs(v) < 0.01 ? 4 : 2;
  return `${nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} $`;
}

const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'];
/** Bytes in powers of 1024: "1,5 Go". */
export function formatBytes(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  let x = v;
  let i = 0;
  while (Math.abs(x) >= 1024 && i < UNITS.length - 1) { x /= 1024; i++; }
  return `${nf({ maximumFractionDigits: i === 0 ? 0 : 1 }).format(x)} ${UNITS[i]}`;
}

/** Seconds → "3 j 4 h", "2 h 5 min", "45 min". */
export function formatUptime(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const d = Math.floor(v / 86400);
  const h = Math.floor((v % 86400) / 3600);
  const m = Math.floor((v % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  return `${nf({ maximumFractionDigits: 1 }).format(v)} %`;
}

/** Top of the value axis and its 3 ticks (0, half, top), from the largest value; never 0 (flat chart). */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 0.5, 1] };
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= max)! * pow;
  return { top: step, ticks: [0, step / 2, step] };
}
