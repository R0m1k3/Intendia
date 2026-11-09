import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const JobSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  prompt: z.string().nullish(),
  schedule: z.unknown().optional(),
  enabled: z.boolean().optional(),
  next_run_at: z.unknown().optional(),
});

/** The dashboard answers a bare array, the API server `{ jobs: [...] }`: both are accepted. */
export const JobListSchema = z.union([z.array(JobSchema), z.looseObject({ jobs: z.array(JobSchema) })]);

export function normaliseJobs(raw: z.infer<typeof JobListSchema>) {
  return Array.isArray(raw) ? raw : raw.jobs;
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
    runs: {
      kind: 'read', probe: false,
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
  },
};
