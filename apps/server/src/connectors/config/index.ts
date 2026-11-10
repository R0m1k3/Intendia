import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const ConfigSchema = z.record(z.string(), z.unknown());

export const ConfigFieldSchema = z.looseObject({
  type: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
});
export const ConfigSchemaSchema = z.looseObject({ fields: z.record(z.string(), ConfigFieldSchema) });

/** Values come back redacted; Intendia never asks for /api/env/reveal. */
export const EnvListSchema = z.record(z.string(), z.looseObject({
  is_set: z.boolean(),
  redacted_value: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  is_password: z.boolean().optional(),
}));

export const McpServersSchema = z.looseObject({
  servers: z.array(z.looseObject({ name: z.string() })),
});

export const configModule: ModuleDef = {
  id: 'config',
  label: 'Réglages Hermes',
  dashboardPage: '/config',
  ops: {
    get: {
      kind: 'read', required: true, probe: true, schema: ConfigSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/config' }],
    },
    // Writes are validated against this schema: without it, the module is read-only.
    schema: {
      kind: 'read', required: true, probe: true, schema: ConfigSchemaSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/config/schema' }],
    },
    defaults: { kind: 'read', probe: true, routes: [{ via: 'dash', method: 'GET', path: '/api/config/defaults' }] },
    env: { kind: 'read', probe: true, schema: EnvListSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/env' }] },
    mcpServers: {
      kind: 'read', probe: true, schema: McpServersSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/mcp/servers' }],
    },
    put: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/config' }] },
    putEnv: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/env' }] },
    deleteEnv: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/env' }] },
    addMcp: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/mcp/servers' }] },
    testMcp: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/mcp/servers/{name}/test' }] },
    enableMcp: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/mcp/servers/{name}/enabled' }] },
    removeMcp: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/mcp/servers/{name}' }] },
    restartGateway: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/gateway/restart' }] },
  },
};
