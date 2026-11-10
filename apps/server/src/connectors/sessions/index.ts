import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const SessionSchema = z.looseObject({
  id: z.string(),
  source: z.string().nullish(),
  title: z.string().nullish(),
  model: z.string().nullish(),
  started_at: z.number().nullish(),
  message_count: z.number().nullish(),
});

export const SessionListSchema = z.looseObject({
  data: z.array(SessionSchema),
  has_more: z.boolean().optional(),
});

export const MessageListSchema = z.unknown();

export const sessionsModule: ModuleDef = {
  id: 'sessions',
  label: 'Sessions',
  dashboardPage: '/sessions',
  ops: {
    list: {
      kind: 'read', required: true, probe: true, schema: SessionListSchema,
      routes: [{ via: 'api', method: 'GET', path: '/api/sessions', capability: 'sessions', feature: 'session_resources' }],
    },
    get: {
      kind: 'read', probe: false, schema: SessionSchema,
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
  },
};
