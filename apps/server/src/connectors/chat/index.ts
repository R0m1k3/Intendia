import { z } from 'zod';
import type { ModuleDef } from '../types.js';

/** Run statuses after which no event will come (0.23.0). */
export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

export const RunCreatedSchema = z.looseObject({ run_id: z.string(), status: z.string().optional() });

/**
 * A question waiting for an answer, as Hermes 0.23 with its gateway session authority lists it in `pending_controls`
 * and sends it in `approval.request` / `clarify.request` (gateway/session_pending_controls.py).
 */
export const PendingControlSchema = z.looseObject({
  kind: z.string().nullish().catch(null),
  prompt_id: z.string().nullish().catch(null),
  execution_generation: z.number().int().nullish().catch(null),
  command: z.string().nullish().catch(null),
  description: z.string().nullish().catch(null),
  question: z.string().nullish().catch(null),
  choices: z.array(z.unknown()).nullish().catch(null),
  multi_select: z.boolean().nullish().catch(null),
});
export type PendingControl = z.infer<typeof PendingControlSchema>;

export const RunStatusSchema = z.looseObject({
  run_id: z.string(),
  status: z.string(),
  session_id: z.string().nullish(),
  created_at: z.number().optional(),
  /** Read for the run's consumption; an unreadable value is dropped, never fails the call. */
  updated_at: z.number().nullish().catch(null),
  model: z.string().nullish().catch(null),
  usage: z.record(z.string(), z.unknown()).nullish().catch(null),
  runtime: z.looseObject({ provider: z.string().nullish(), model: z.string().nullish() }).nullish().catch(null),
  output: z.string().nullish(),
  error: z.string().nullish(),
  /** Generation of the run's turn (gateway session authority only): required to answer an approval or a question. */
  execution_generation: z.number().int().nullish().catch(null),
  pending_controls: z.array(z.unknown()).optional().catch([]).transform((list) =>
    (list ?? []).flatMap((p) => { const r = PendingControlSchema.safeParse(p); return r.success ? [r.data] : []; })),
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
    is_user_defined: z.boolean().optional(),
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
    /**
     * Answer to a question of the agent (clarify tool). In the 0.23.0 source (gateway/platforms/api_server_runs.py) but not
     * announced in /v1/capabilities: no capability, always tried. Gateway session authority only. No fixture (a question
     * needs a provider key to happen); covered by the fake.
     */
    clarify: {
      kind: 'write',
      routes: [{ via: 'api', method: 'POST', path: '/v1/runs/{run_id}/clarify' }],
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
