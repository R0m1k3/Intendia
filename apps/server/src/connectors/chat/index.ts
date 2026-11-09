import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const RunCreatedSchema = z.looseObject({ run_id: z.string(), status: z.string().optional() });

export const RunStatusSchema = z.looseObject({
  run_id: z.string(),
  status: z.string(),
  session_id: z.string().nullish(),
  output: z.string().nullish(),
  pending_controls: z.array(z.unknown()).optional(),
});

/** Every SSE `data:` payload of /v1/runs/{id}/events. Unknown event types are kept and shown generically. */
export const RunEventSchema = z.looseObject({
  event: z.string(),
  run_id: z.string().optional(),
  seq: z.number().optional(),
  timestamp: z.number().optional(),
});

export const ModelOptionsSchema = z.looseObject({
  model: z.string().nullish(),
  provider: z.string().nullish(),
  providers: z.array(z.looseObject({
    slug: z.string(),
    name: z.string().optional(),
    authenticated: z.boolean().optional(),
    models: z.array(z.unknown()).optional(),
  })),
});

export const chatModule: ModuleDef = {
  id: 'chat',
  label: 'Chat',
  ops: {
    createRun: {
      kind: 'write', required: true, schema: RunCreatedSchema,
      routes: [{ via: 'api', method: 'POST', path: '/v1/runs', capability: 'runs', feature: 'run_submission' }],
    },
    runStatus: {
      kind: 'read', required: true, probe: false, schema: RunStatusSchema,
      routes: [{ via: 'api', method: 'GET', path: '/v1/runs/{run_id}', capability: 'run_status', feature: 'run_status' }],
    },
    runEvents: {
      kind: 'read', required: true, probe: false,
      routes: [{ via: 'api', method: 'GET', path: '/v1/runs/{run_id}/events', capability: 'run_events', feature: 'run_events_sse' }],
    },
    stopRun: {
      kind: 'write',
      routes: [{ via: 'api', method: 'POST', path: '/v1/runs/{run_id}/stop', capability: 'run_stop', feature: 'run_stop' }],
    },
    approval: {
      kind: 'write',
      routes: [{ via: 'api', method: 'POST', path: '/v1/runs/{run_id}/approval', capability: 'run_approval', feature: 'run_approval_response' }],
    },
    steer: {
      kind: 'write',
      routes: [{ via: 'api', method: 'POST', path: '/v1/runs/{run_id}/steer', capability: 'run_steer', feature: 'run_steer' }],
    },
    modelOptions: {
      kind: 'read', probe: true, schema: ModelOptionsSchema,
      routes: [
        { via: 'api', method: 'GET', path: '/api/model/options', capability: 'model_options', feature: 'model_options' },
        { via: 'dash', method: 'GET', path: '/api/model/options' },
      ],
    },
  },
};
