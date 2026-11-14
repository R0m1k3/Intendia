import type { CompatService } from '../compat/service.js';
import { callOp, HermesError, hermesDetail } from '../connectors/runtime.js';
import { LogsSchema, SessionStatsSchema, SystemStatsSchema, UsageSchema, type HermesUsage } from '../connectors/monitor/index.js';
import type { ConfigService } from '../hermes-config/service.js';
import { hostPaths, Masker } from '../hermes-config/mask.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';
import { msg } from '../i18n/index.js';

export const USAGE_DAYS = [7, 30, 90] as const;
export const LOG_FILES = ['agent', 'errors', 'gateway', 'gui', 'desktop', 'update', 'handoff', 'mcp'] as const;
export const LOG_LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR'] as const;
export const LOG_COMPONENTS = ['gateway', 'agent', 'tools', 'cli', 'cron', 'gui'] as const;
export const LOG_LINES = [100, 200, 500] as const;
/** Logs Hermes copies without its redacting formatter. */
export const UNREDACTED_LOGS: readonly string[] = ['mcp', 'update', 'desktop', 'handoff'];
const LINE_MAX = 4000;
const SEARCH_MAX = 200;
const SYSTEM_TTL_MS = 5000;
const TOP = 10;

export interface UsageTotals {
  input: number | null; output: number | null; cacheRead: number | null; reasoning: number | null;
  estimatedCost: number | null; actualCost: number | null; sessions: number | null; apiCalls: number | null;
}
export interface PublicUsage {
  days: number;
  totals: UsageTotals;
  daily: { day: string; estimatedCost: number | null; actualCost: number | null; input: number | null; output: number | null; sessions: number | null; apiCalls: number | null }[];
  byModel: { model: string; input: number | null; output: number | null; estimatedCost: number | null; sessions: number | null; apiCalls: number | null }[];
  tools: { name: string; count: number | null; percentage: number | null }[];
  skills: { name: string; count: number | null; percentage: number | null }[];
  /** Sessions by source (cli, api_server, cron…); null when Hermes could not give it. */
  sources: Record<string, number> | null;
  /** Parts Hermes failed to give. */
  partial: string[];
}

export interface LogQuery { file: string; lines: number; level?: string; component?: string; search?: string }
export interface PublicLogs { file: string; lines: string[]; unredacted: boolean }

export interface PublicSystemStats {
  psutil: boolean;
  hostname: string | null;
  system: string | null;
  release: string | null;
  arch: string | null;
  hermesVersion: string | null;
  pythonVersion: string | null;
  cpuCount: number | null;
  cpuPercent: number | null;
  loadAvg: number[] | null;
  uptimeSeconds: number | null;
  memory: { total: number | null; used: number | null; available: number | null; percent: number | null } | null;
  disk: { total: number | null; used: number | null; free: number | null; percent: number | null } | null;
  process: { rss: number | null; threads: number | null } | null;
}

const n = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toUsage(days: number, u: HermesUsage): Omit<PublicUsage, 'sources' | 'partial'> {
  const t = u.totals ?? {};
  return {
    days,
    totals: {
      input: n(t.total_input), output: n(t.total_output), cacheRead: n(t.total_cache_read), reasoning: n(t.total_reasoning),
      estimatedCost: n(t.total_estimated_cost), actualCost: n(t.total_actual_cost), sessions: n(t.total_sessions), apiCalls: n(t.total_api_calls),
    },
    daily: u.daily.map((d) => ({
      day: d.day, estimatedCost: n(d.estimated_cost), actualCost: n(d.actual_cost), input: n(d.input_tokens), output: n(d.output_tokens),
      sessions: n(d.sessions), apiCalls: n(d.api_calls),
    })),
    byModel: u.by_model.map((m) => ({
      model: m.model ?? '?', input: n(m.input_tokens), output: n(m.output_tokens), estimatedCost: n(m.estimated_cost), sessions: n(m.sessions), apiCalls: n(m.api_calls),
    })),
    tools: (u.tools ?? []).slice(0, TOP).map((x) => ({ name: x.tool, count: n(x.count), percentage: n(x.percentage) })),
    skills: (u.skills?.top_skills ?? []).slice(0, TOP).map((x) => ({ name: x.skill, count: n(x.total_count), percentage: n(x.percentage) })),
  };
}

function oneOf<T extends string | number>(list: readonly T[], value: T, what: string): T {
  if (!list.includes(value)) throw new ValidationError(msg('{name} invalide', { name: what }));
  return value;
}

export class MonitorService {
  private readonly mask: Masker;
  private readonly system = new Map<string, { at: number; value: PublicSystemStats }>();

  constructor(private readonly compat: CompatService, private readonly store: InstanceStore, secret: string, private readonly config: ConfigService) {
    this.mask = new Masker(secret);
  }

  private ctx(instanceId: string) {
    if (!this.store.get(instanceId)) throw new NotFoundError(msg('Instance inconnue : {id}', { id: instanceId }));
    return { http: this.compat.http(instanceId), report: this.compat.get(instanceId) };
  }

  /** Hermes' error text masked (it may quote paths or values). */
  private async call<T>(instanceId: string, op: string, opts: Parameters<typeof callOp>[4]): Promise<T> {
    const { http, report } = this.ctx(instanceId);
    try {
      return await callOp<T>(http, report, 'monitor', op, opts);
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') {
        const detail = hostPaths(this.mask.text(hermesDetail(err)));
        if (err.detail.status === 404) throw new NotFoundError(msg('{what} : {detail}', { what: msg('Introuvable'), detail }));
        if (err.detail.status === 400 || err.detail.status === 422) throw new ValidationError(msg('Requête refusée par Hermes : {detail}', { detail }));
        throw new HermesError('http', msg('Hermes : {detail}', { detail }), err.detail);
      }
      throw err;
    }
  }

  async usage(instanceId: string, profile: string, days: number): Promise<PublicUsage> {
    oneOf(USAGE_DAYS, days as 7, msg('période'));
    const [usage, stats] = await Promise.allSettled([
      this.call<unknown>(instanceId, 'usage', { profile, query: { days: String(days) } }),
      this.call<unknown>(instanceId, 'sessionStats', { profile }),
    ]);
    if (usage.status === 'rejected') throw usage.reason;
    const partial: string[] = [];
    let sources: Record<string, number> | null = null;
    if (stats.status === 'fulfilled') sources = SessionStatsSchema.parse(stats.value).by_source ?? {};
    else partial.push('sources');
    return { ...toUsage(days, UsageSchema.parse(usage.value)), sources, partial };
  }

  async logs(instanceId: string, profile: string, q: LogQuery): Promise<PublicLogs> {
    const file = oneOf(LOG_FILES, q.file as 'agent', msg('journal'));
    const lines = oneOf(LOG_LINES, q.lines as 100, msg('nombre de lignes'));
    const query: Record<string, string> = { file, lines: String(lines) };
    if (q.level) query.level = oneOf(LOG_LEVELS, q.level as 'ALL', msg('niveau'));
    if (q.component) query.component = oneOf(LOG_COMPONENTS, q.component as 'agent', msg('composant'));
    if (q.search) {
      if (q.search.length > SEARCH_MAX) throw new ValidationError(msg('recherche trop longue'));
      query.search = q.search;
    }
    const [raw, known] = await Promise.all([
      this.call<unknown>(instanceId, 'logs', { profile, query }),
      this.config.knownSecrets(instanceId, profile),
    ]);
    // Hermes gives raw lines with their newline
    const out = LogsSchema.parse(raw).lines.map((l) => hostPaths(this.mask.known(this.mask.text(l.replace(/\r?\n$/, '')), known)).slice(0, LINE_MAX));
    return { file, lines: out, unredacted: UNREDACTED_LOGS.includes(file) };
  }

  async systemStats(instanceId: string): Promise<PublicSystemStats> {
    const hit = this.system.get(instanceId);
    if (hit && Date.now() - hit.at < SYSTEM_TTL_MS) return hit.value;
    const s = SystemStatsSchema.parse(await this.call<unknown>(instanceId, 'system', {}));
    const value: PublicSystemStats = {
      psutil: s.psutil !== false,
      hostname: s.hostname ?? null,
      system: s.system ?? s.platform ?? null,
      release: s.release ?? null,
      arch: s.arch ?? null,
      hermesVersion: s.hermes_version ?? null,
      pythonVersion: s.python_version ?? null,
      cpuCount: n(s.cpu_count),
      cpuPercent: n(s.cpu_percent),
      loadAvg: s.load_avg ?? null,
      uptimeSeconds: n(s.uptime_seconds),
      memory: s.memory ? { total: n(s.memory.total), used: n(s.memory.used), available: n(s.memory.available), percent: n(s.memory.percent) } : null,
      disk: s.disk ? { total: n(s.disk.total), used: n(s.disk.used), free: n(s.disk.free), percent: n(s.disk.percent) } : null,
      process: s.process ? { rss: n(s.process.rss), threads: n(s.process.num_threads) } : null,
    };
    this.system.set(instanceId, { at: Date.now(), value });
    return value;
  }
}
