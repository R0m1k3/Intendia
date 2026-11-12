import { z } from 'zod';
import type { ModuleDef } from '../types.js';

const num = z.number().nullish();

export const UsageDaySchema = z.looseObject({
  day: z.string(),
  input_tokens: num, output_tokens: num, cache_read_tokens: num, reasoning_tokens: num,
  estimated_cost: num, actual_cost: num, sessions: num, api_calls: num,
});
export const UsageSchema = z.looseObject({
  daily: z.array(UsageDaySchema).default([]),
  by_model: z.array(z.looseObject({
    model: z.string().nullish(), input_tokens: num, output_tokens: num, estimated_cost: num, sessions: num, api_calls: num,
  })).default([]),
  totals: z.looseObject({
    total_input: num, total_output: num, total_cache_read: num, total_reasoning: num,
    total_estimated_cost: num, total_actual_cost: num, total_sessions: num, total_api_calls: num,
  }).optional(),
  period_days: z.number().optional(),
  skills: z.looseObject({
    top_skills: z.array(z.looseObject({ skill: z.string(), total_count: num, percentage: num })).optional(),
  }).nullish(),
  tools: z.array(z.looseObject({ tool: z.string(), count: num, percentage: num })).nullish(),
});
export type HermesUsage = z.infer<typeof UsageSchema>;

export const SessionStatsSchema = z.looseObject({
  total: num, archived: num, messages: num,
  by_source: z.record(z.string(), z.number()).nullish(),
});

export const LogsSchema = z.looseObject({ file: z.string().optional(), lines: z.array(z.string()) });

export const SystemStatsSchema = z.looseObject({
  system: z.string().nullish(), release: z.string().nullish(), platform: z.string().nullish(), arch: z.string().nullish(),
  hostname: z.string().nullish(), python_version: z.string().nullish(), hermes_version: z.string().nullish(),
  cpu_count: num, cpu_percent: num, uptime_seconds: num,
  load_avg: z.array(z.number()).nullish(),
  memory: z.looseObject({ total: num, available: num, used: num, percent: num }).nullish(),
  disk: z.looseObject({ total: num, used: num, free: num, percent: num }).nullish(),
  process: z.looseObject({ pid: num, rss: num, num_threads: num, create_time: num }).nullish(),
  psutil: z.boolean().nullish(),
});
export type HermesSystemStats = z.infer<typeof SystemStatsSchema>;

/** Usage stats, logs and host metrics of the dashboard (lot 8 A: options 46, 47, 59). Read only. */
export const monitorModule: ModuleDef = {
  id: 'monitor',
  label: 'Suivi',
  dashboardPage: '/analytics',
  ops: {
    usage: {
      kind: 'read', required: true, probe: true, schema: UsageSchema, probeQuery: { days: '7' },
      routes: [{ via: 'dash', method: 'GET', path: '/api/analytics/usage' }],
    },
    sessionStats: {
      kind: 'read', optional: true, probe: true, schema: SessionStatsSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/sessions/stats' }],
    },
    logs: {
      kind: 'read', optional: true, probe: true, schema: LogsSchema, probeQuery: { lines: '1' },
      routes: [{ via: 'dash', method: 'GET', path: '/api/logs' }],
    },
    system: {
      kind: 'read', optional: true, probe: true, schema: SystemStatsSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/system/stats' }],
    },
  },
};
