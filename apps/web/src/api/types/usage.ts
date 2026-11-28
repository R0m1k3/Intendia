export interface UsageTotals {
  input: number | null; output: number | null; cacheRead: number | null; reasoning: number | null;
  estimatedCost: number | null; actualCost: number | null; sessions: number | null; apiCalls: number | null;
}
export interface UsageDay { day: string; estimatedCost: number | null; actualCost: number | null; input: number | null; output: number | null; sessions: number | null; apiCalls: number | null }
export interface PublicUsage {
  days: number;
  totals: UsageTotals;
  daily: UsageDay[];
  byModel: { model: string; input: number | null; output: number | null; estimatedCost: number | null; sessions: number | null; apiCalls: number | null }[];
  tools: { name: string; count: number | null; percentage: number | null }[];
  skills: { name: string; count: number | null; percentage: number | null }[];
  sources: Record<string, number> | null;
  partial: string[];
}
export interface LogQuery { file: string; lines: number; level?: string; component?: string; search?: string }
export interface PublicLogs { file: string; lines: string[]; unredacted: boolean }
export interface PublicSystemStats {
  psutil: boolean; hostname: string | null; system: string | null; release: string | null; arch: string | null;
  hermesVersion: string | null; pythonVersion: string | null; cpuCount: number | null; cpuPercent: number | null;
  loadAvg: number[] | null; uptimeSeconds: number | null;
  memory: { total: number | null; used: number | null; available: number | null; percent: number | null } | null;
  disk: { total: number | null; used: number | null; free: number | null; percent: number | null } | null;
  process: { rss: number | null; threads: number | null } | null;
}
