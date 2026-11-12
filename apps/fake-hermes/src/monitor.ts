// Usage stats, logs and host metrics of the dashboard (Hermes 0.23 `/api/analytics/usage`, `/api/sessions/stats`,
// `/api/logs`, `/api/system/stats`): deterministic data, filters like Hermes.
import { FAKE_SECRETS } from './config.js';

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

export const FAKE_LOG_FILES = ['agent', 'errors', 'gateway', 'gui', 'desktop', 'update', 'handoff', 'mcp'];
const COMPONENTS = ['gateway', 'agent', 'tools', 'cli', 'cron', 'gui'];
const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
const RANK: Record<string, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, CRITICAL: 50 };
const MODELS = ['anthropic/claude-sonnet-4', 'openai/gpt-5-mini', 'google/gemini-2.5-flash'];
const DAY_MS = 86_400_000;

export interface MonitorFakeOptions {
  /** `/api/system/stats` without psutil (identity and load only). */
  psutil?: boolean;
}

function logLines(file: string): string[] {
  const out: string[] = [];
  const base = Date.UTC(2026, 10, 12, 8, 0, 0);
  for (let i = 0; i < 600; i++) {
    const level = LEVELS[i % 4 === 3 ? 3 : i % 3]!;
    const comp = COMPONENTS[i % COMPONENTS.length]!;
    const ts = new Date(base + i * 7000).toISOString().replace('T', ' ').slice(0, 19);
    out.push(`${ts},000 ${level} [${comp}] ${file} ligne ${i + 1}${i % 50 === 0 ? ' chargé depuis /opt/data/profiles/x/config.yaml' : ''}`);
  }
  if (file === 'mcp') {
    out.push(`2026-11-12 09:10:00,000 ERROR [tools] demo: connecting with api_key=sk-test-leak-0009abcdef`);
    out.push(`2026-11-12 09:10:01,000 ERROR [tools] demo: relay refused ${FAKE_SECRETS.plain}`);
  }
  return out;
}

export class MonitorStore {
  /** Calls per route (tests: a refused query must not reach the fake). */
  readonly calls: { path: string; query: Record<string, string> }[] = [];

  constructor(private readonly opts: MonitorFakeOptions = {}) {}

  handle(method: string, path: string, query: Record<string, string>): Reply | null {
    if (method !== 'GET') return null;
    if (!['/api/analytics/usage', '/api/sessions/stats', '/api/logs', '/api/system/stats'].includes(path)) return null;
    this.calls.push({ path, query });
    if (path === '/api/analytics/usage') return this.usage(query);
    if (path === '/api/sessions/stats') return { status: 200, body: { total: 42, active_store: 40, archived: 2, messages: 512, by_source: { api_server: 30, cli: 8, cron: 4 } } };
    if (path === '/api/logs') return this.logs(query);
    return this.system();
  }

  private usage(q: Record<string, string>): Reply {
    const days = Number(q.days ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) return { status: 422, body: { detail: 'days must be between 1 and 365' } };
    const today = Date.UTC(2026, 10, 12);
    const daily: Json[] = [];
    let tin = 0; let tout = 0; let cost = 0; let sessions = 0; let calls = 0;
    for (let i = days - 1; i >= 0; i--) {
      const k = (i * 7 + 3) % 11;
      if (k === 0) continue; // a few days without activity
      const d = { day: new Date(today - i * DAY_MS).toISOString().slice(0, 10), input_tokens: k * 1200, output_tokens: k * 300, cache_read_tokens: k * 50, reasoning_tokens: k * 10, estimated_cost: Math.round(k * 0.0137 * 1e4) / 1e4, actual_cost: 0, sessions: 1 + (k % 3), api_calls: k * 2 };
      tin += d.input_tokens; tout += d.output_tokens; cost += d.estimated_cost; sessions += d.sessions; calls += d.api_calls;
      daily.push(d);
    }
    const by_model = MODELS.map((model, i) => ({ model, input_tokens: Math.round(tin / (i + 2)), output_tokens: Math.round(tout / (i + 2)), estimated_cost: Math.round((cost / (i + 2)) * 1e4) / 1e4, sessions: Math.max(1, Math.round(sessions / (i + 2))), api_calls: Math.round(calls / (i + 2)) }));
    return {
      status: 200,
      body: {
        daily, by_model, by_task: [],
        totals: { total_input: tin, total_output: tout, total_cache_read: 0, total_reasoning: null, total_estimated_cost: Math.round(cost * 1e4) / 1e4, total_actual_cost: 0, total_sessions: sessions, total_api_calls: calls },
        period_days: days,
        skills: { summary: { total_skill_loads: 9 }, top_skills: [{ skill: 'fake/recherche-web', view_count: 5, manage_count: 1, total_count: 6, percentage: 66.7 }, { skill: 'fake/resume', view_count: 3, manage_count: 0, total_count: 3, percentage: 33.3 }] },
        tools: [{ tool: 'terminal', count: 40, percentage: 40 }, { tool: 'read_file', count: 30, percentage: 30 }, { tool: 'web_search', count: 20, percentage: 20 }, { tool: 'write_file', count: 8, percentage: 8 }, { tool: 'delegate', count: 2, percentage: 2 }],
      },
    };
  }

  private logs(q: Record<string, string>): Reply {
    const file = q.file ?? 'agent';
    if (!FAKE_LOG_FILES.includes(file)) return { status: 400, body: { detail: `Unknown log file: ${file}` } };
    const lines = Math.min(Number(q.lines ?? 100) || 100, 500);
    if (q.component && !COMPONENTS.includes(q.component)) return { status: 400, body: { detail: `component must be one of ${COMPONENTS.join(', ')}` } };
    if (q.search === 'panne') return { status: 500, body: { detail: 'Failed to read log /opt/data/logs/agent.log' } };
    let all = logLines(file);
    const min = q.level && q.level !== 'ALL' ? RANK[q.level.toUpperCase()] ?? 0 : 0;
    if (min) all = all.filter((l) => (RANK[/ (DEBUG|INFO|WARNING|ERROR) /.exec(l)?.[1] ?? 'INFO'] ?? 0) >= min);
    if (q.component) all = all.filter((l) => l.includes(`[${q.component}]`));
    if (q.search) all = all.slice(-2000).filter((l) => l.toLowerCase().includes(q.search!.toLowerCase()));
    // Hermes keeps the newline of each raw line
    return { status: 200, body: { file, lines: all.slice(-lines).map((l) => `${l}\n`) } };
  }

  private system(): Reply {
    const id = { system: 'Linux', release: '6.8.0-fake', version: '#1 SMP', platform: 'Linux-6.8.0-fake-x86_64', arch: 'x86_64', hostname: 'fake-hermes-host', python_version: '3.12.7', python_impl: 'CPython', hermes_version: '0.23.0', load_avg: [0.42, 0.37, 0.3] };
    if (this.opts.psutil === false) return { status: 200, body: { ...id, psutil: false } };
    return {
      status: 200,
      body: {
        ...id, psutil: true, cpu_count: 8, cpu_percent: 12.5, uptime_seconds: 3 * 86400 + 4 * 3600 + 120,
        memory: { total: 16 * 2 ** 30, available: 9 * 2 ** 30, used: 7 * 2 ** 30, percent: 43.8 },
        disk: { total: 200 * 2 ** 30, used: 61 * 2 ** 30, free: 139 * 2 ** 30, percent: 30.5 },
        process: { pid: 4242, rss: 180 * 2 ** 20, create_time: 1762934400, num_threads: 14 },
      },
    };
  }
}
