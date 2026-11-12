import { z } from 'zod';
import type { Via } from '../../hermes/http.js';
import type { ModuleDef } from '../types.js';

const ScheduleSchema = z.union([
  z.looseObject({
    kind: z.string(),
    minutes: z.number().nullish(),
    expr: z.string().nullish(),
    run_at: z.string().nullish(),
    display: z.string().nullish(),
  }),
  z.string(),
]);

/** Tolerant: only the fields Intendia reads; unknown fields are kept. */
export const JobSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  prompt: z.string().nullish(),
  schedule: ScheduleSchema.nullish(),
  schedule_display: z.string().nullish(),
  enabled: z.boolean().optional(),
  state: z.string().nullish(),
  next_run_at: z.string().nullish(),
  last_run_at: z.string().nullish(),
  last_status: z.string().nullish(),
  last_error: z.string().nullish(),
  last_delivery_error: z.string().nullish(),
  failure_streak: z.number().nullish(),
  deliver: z.string().nullish(),
  skills: z.array(z.string()).nullish(),
  model: z.string().nullish(),
  workdir: z.string().nullish(),
  timezone: z.string().nullish(),
  profile: z.string().nullish(),
  /** times null = forever */
  repeat: z.looseObject({ times: z.number().nullish(), completed: z.number().nullish() }).nullish(),
  enabled_toolsets: z.array(z.string()).nullish(),
  catch_up: z.boolean().nullish(),
  grace_minutes: z.number().nullish(),
  context_from: z.array(z.string()).nullish(),
});

export type HermesJob = z.infer<typeof JobSchema>;

/** The dashboard answers a bare array, the API server `{ jobs: [...] }`: both are accepted. */
export const JobListSchema = z.union([z.array(JobSchema), z.looseObject({ jobs: z.array(JobSchema) })]);

export function normaliseJobs(raw: z.infer<typeof JobListSchema>): HermesJob[] {
  return Array.isArray(raw) ? raw : raw.jobs;
}

/** Dashboard GET answers the job, the API server `{ job }`. */
export const JobGetSchema = z.union([z.looseObject({ job: JobSchema }).transform((v) => v.job), JobSchema]);

export const RunSchema = z.looseObject({
  id: z.string(),
  started_at: z.number().nullish(),
  ended_at: z.number().nullish(),
  end_reason: z.string().nullish(),
  message_count: z.number().nullish(),
  tool_call_count: z.number().nullish(),
  estimated_cost_usd: z.number().nullish(),
  model: z.string().nullish(),
});

export const RunListSchema = z.looseObject({ runs: z.array(RunSchema) });

/** Cron templates of the dashboard (`/api/cron/blueprints`): the prompt itself is not returned. */
export const BlueprintFieldSchema = z.looseObject({
  name: z.string(),
  type: z.string().nullish(),
  label: z.string().nullish(),
  default: z.unknown().optional(),
  options: z.array(z.union([z.string(), z.looseObject({ value: z.unknown(), label: z.string().nullish() })])).nullish(),
  optional: z.boolean().nullish(),
  help: z.string().nullish(),
});
export const BlueprintSchema = z.looseObject({
  key: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  fields: z.array(BlueprintFieldSchema).nullish(),
  source: z.string().nullish(),
  plugin: z.string().nullish(),
  scheduleHuman: z.string().nullish(),
});
export const BlueprintListSchema = z.looseObject({ blueprints: z.array(BlueprintSchema) });

export const TargetListSchema = z.looseObject({
  targets: z.array(z.looseObject({ id: z.string(), name: z.string().nullish() })),
});

/** Update body: the dashboard wants `{ updates }` (PUT), the API server the fields themselves (PATCH). */
export function updateBody(via: Via, fields: Record<string, unknown>): unknown {
  return via === 'dash' ? { updates: fields } : fields;
}

// Two sources exist: the dashboard (/api/cron/*, listed in its OpenAPI) and the API server
// (/api/jobs, not announced in /v1/capabilities: `jobs_admin: false` in 0.23.0). Dashboard first.
export const cronsModule: ModuleDef = {
  id: 'crons',
  label: 'Crons',
  dashboardPage: '/cron',
  ops: {
    list: {
      kind: 'read', required: true, probe: true, schema: JobListSchema,
      routes: [
        { via: 'dash', method: 'GET', path: '/api/cron/jobs' },
        { via: 'api', method: 'GET', path: '/api/jobs' },
      ],
    },
    get: {
      kind: 'read', probe: false, schema: JobGetSchema,
      routes: [
        { via: 'dash', method: 'GET', path: '/api/cron/jobs/{job_id}' },
        { via: 'api', method: 'GET', path: '/api/jobs/{job_id}' },
      ],
    },
    targets: {
      kind: 'read', probe: true, schema: TargetListSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/cron/delivery-targets' }],
    },
    runs: {
      kind: 'read', probe: false, schema: RunListSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/cron/jobs/{job_id}/runs' }],
    },
    create: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'POST', path: '/api/cron/jobs' },
        { via: 'api', method: 'POST', path: '/api/jobs' },
      ],
    },
    update: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'PUT', path: '/api/cron/jobs/{job_id}' },
        { via: 'api', method: 'PATCH', path: '/api/jobs/{job_id}' },
      ],
    },
    remove: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'DELETE', path: '/api/cron/jobs/{job_id}' },
        { via: 'api', method: 'DELETE', path: '/api/jobs/{job_id}' },
      ],
    },
    pause: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'POST', path: '/api/cron/jobs/{job_id}/pause' },
        { via: 'api', method: 'POST', path: '/api/jobs/{job_id}/pause' },
      ],
    },
    resume: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'POST', path: '/api/cron/jobs/{job_id}/resume' },
        { via: 'api', method: 'POST', path: '/api/jobs/{job_id}/resume' },
      ],
    },
    trigger: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'POST', path: '/api/cron/jobs/{job_id}/trigger' },
        { via: 'api', method: 'POST', path: '/api/jobs/{job_id}/run' },
      ],
    },
    cancel: {
      kind: 'write',
      routes: [{ via: 'dash', method: 'POST', path: '/api/cron/jobs/{job_id}/cancel' }],
    },
    blueprints: {
      kind: 'read', optional: true, probe: true, schema: BlueprintListSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/cron/blueprints' }],
    },
    instantiate: {
      kind: 'write', optional: true,
      routes: [{ via: 'dash', method: 'POST', path: '/api/cron/blueprints/instantiate' }],
    },
  },
};
