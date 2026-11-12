import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const SessionSchema = z.looseObject({
  id: z.string(),
  source: z.string().nullish(),
  title: z.string().nullish(),
  model: z.string().nullish(),
  started_at: z.number().nullish(),
  message_count: z.number().nullish(),
  /** Cumulated cost of the session (null before anything is counted). */
  estimated_cost_usd: z.number().nullish().catch(null),
  actual_cost_usd: z.number().nullish().catch(null),
});

export const SessionListSchema = z.looseObject({
  data: z.array(SessionSchema),
  has_more: z.boolean().optional(),
});

/** GET /api/sessions/{id}: 0.23.0 wraps the session in `{session}`; a flat object is accepted too. */
export const SessionGetSchema = z.union([
  z.looseObject({ session: SessionSchema }).transform((v) => v.session),
  SessionSchema,
]);

export const MessageSchema = z.looseObject({
  id: z.number(),
  role: z.string(),
  content: z.unknown().optional(),
  tool_calls: z.unknown().optional(),
  tool_name: z.string().nullish(),
  timestamp: z.number().nullish(),
});

/** `session_id`: the live session (after a context compression, its continuation). */
export const MessageListSchema = z.looseObject({ data: z.array(MessageSchema), session_id: z.string().nullish().catch(null) });

/** Dashboard search (id, then FTS5 on messages); `snippet` marks the hit with `>>>` and `<<<`. */
export const SessionSearchSchema = z.looseObject({
  results: z.array(z.looseObject({
    id: z.string().nullish(),
    session_id: z.string().nullish(),
    source: z.string().nullish(),
    title: z.string().nullish(),
    snippet: z.string().nullish(),
    last_active: z.number().nullish(),
    message_count: z.number().nullish(),
    profile: z.string().nullish(),
  })),
});

/** GET /api/sessions/{id}/export (dashboard): the session row and every message row, with their flags. */
export const ExportSchema = z.looseObject({
  id: z.string().nullish(),
  source: z.string().nullish(),
  title: z.string().nullish(),
  model: z.string().nullish(),
  started_at: z.number().nullish(),
  system_prompt: z.string().nullish(),
  messages: z.array(z.looseObject({ role: z.string() })),
});

/** POST /api/sessions/import (dashboard). */
export const ImportResultSchema = z.looseObject({
  imported_ids: z.array(z.string()).catch([]),
  skipped_ids: z.array(z.string()).catch([]),
  errors: z.array(z.unknown()).catch([]),
});

export const sessionsModule: ModuleDef = {
  id: 'sessions',
  label: 'Sessions',
  dashboardPage: '/sessions',
  ops: {
    list: {
      kind: 'read', required: true, probe: true, schema: SessionListSchema,
      routes: [{ via: 'api', method: 'GET', path: '/api/sessions', capability: 'sessions', feature: 'session_resources' }],
    },
    // not probed: without `q` it answers an empty list, which proves nothing
    search: {
      kind: 'read', probe: false, schema: SessionSearchSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/sessions/search' }],
    },
    get: {
      kind: 'read', probe: false, schema: SessionGetSchema,
      routes: [{ via: 'api', method: 'GET', path: '/api/sessions/{session_id}', capability: 'session' }],
    },
    messages: {
      kind: 'read', required: true, probe: false, schema: MessageListSchema,
      routes: [{ via: 'api', method: 'GET', path: '/api/sessions/{session_id}/messages', capability: 'session_messages' }],
    },
    create: {
      kind: 'write',
      routes: [{ via: 'api', method: 'POST', path: '/api/sessions', capability: 'session_create' }],
    },
    update: {
      kind: 'write',
      routes: [{ via: 'api', method: 'PATCH', path: '/api/sessions/{session_id}', capability: 'session_update' }],
    },
    remove: {
      kind: 'write',
      routes: [{ via: 'api', method: 'DELETE', path: '/api/sessions/{session_id}', capability: 'session_delete' }],
    },
    // copies (duplicate, continue a session from elsewhere, import a file): dashboard only
    export: {
      kind: 'read', optional: true, probe: false, schema: ExportSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/sessions/{session_id}/export' }],
    },
    import: {
      kind: 'write', optional: true, schema: ImportResultSchema,
      routes: [{ via: 'dash', method: 'POST', path: '/api/sessions/import' }],
    },
  },
};
