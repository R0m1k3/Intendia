import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const HealthDetailedSchema = z.looseObject({
  status: z.string(),
  version: z.string().optional(),
  gateway_state: z.string().optional(),
  readiness: z.looseObject({ status: z.string(), checks: z.record(z.string(), z.unknown()).optional() }).optional(),
});

export const DashStatusSchema = z.looseObject({
  version: z.string().optional(),
  release_date: z.string().optional(),
  gateway_running: z.boolean().optional(),
  gateway_state: z.string().optional(),
});

export const healthModule: ModuleDef = {
  id: 'health',
  label: 'Santé',
  ops: {
    detailed: {
      kind: 'read', required: true, probe: true, schema: HealthDetailedSchema,
      routes: [{ via: 'api', method: 'GET', path: '/health/detailed', capability: 'health_detailed' }],
    },
    dashboardStatus: {
      kind: 'read', probe: true, schema: DashStatusSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/status' }],
    },
  },
};
