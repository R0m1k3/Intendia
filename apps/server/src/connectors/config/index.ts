import { z } from 'zod';
import { ActionStatusSchema } from '../actions.js';
import type { ModuleDef } from '../types.js';

export const ConfigSchema = z.record(z.string(), z.unknown());

export const ConfigFieldSchema = z.looseObject({
  type: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  options: z.array(z.unknown()).optional(),
  clearable: z.boolean().optional(),
});
export type HermesConfigField = z.infer<typeof ConfigFieldSchema>;
export const ConfigSchemaSchema = z.looseObject({
  fields: z.record(z.string(), ConfigFieldSchema),
  category_order: z.array(z.string()).optional(),
});

/** Text of the Hermes config file, exactly as written (may hold secrets: mask before answering). */
export const RawConfigSchema = z.looseObject({ yaml: z.string() });

/** Values come back redacted; Intendia never asks for /api/env/reveal. */
export const EnvListSchema = z.record(z.string(), z.looseObject({
  is_set: z.boolean(),
  redacted_value: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  is_password: z.boolean().optional(),
  advanced: z.boolean().optional(),
  channel_managed: z.boolean().optional(),
  provider: z.string().nullish(),
  custom: z.boolean().optional(),
}));

export const McpServersSchema = z.looseObject({
  servers: z.array(z.looseObject({
    name: z.string(),
    transport: z.string().nullish(),
    url: z.string().nullish(),
    command: z.string().nullish(),
    args: z.array(z.string()).nullish(),
    env: z.record(z.string(), z.unknown()).nullish(),
    auth: z.string().nullish(),
    enabled: z.boolean().optional(),
    tools: z.unknown().optional(),
    source: z.string().nullish(),
    plugin: z.string().nullish(),
  })),
});

export const ModelInfoSchema = z.looseObject({
  model: z.string(),
  provider: z.string(),
  effective_context_length: z.number().nullish(),
});

export const ModelOptionsSchema = z.looseObject({
  providers: z.array(z.looseObject({
    slug: z.string(),
    name: z.string(),
    authenticated: z.boolean().optional(),
    is_user_defined: z.boolean().optional(),
    key_env: z.string().nullish(),
    models: z.array(z.string()).optional(),
    warning: z.string().nullish(),
  })),
});

export const AuxiliarySchema = z.looseObject({
  tasks: z.array(z.looseObject({
    task: z.string(),
    label: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string().nullish(),
  })),
});

export const ModelSetSchema = z.looseObject({
  ok: z.boolean().optional(),
  confirm_required: z.boolean().optional(),
  confirm_message: z.string().nullish(),
  notice: z.string().nullish(),
});

export const PlatformsSchema = z.looseObject({
  platforms: z.array(z.looseObject({
    id: z.string(),
    name: z.string(),
    enabled: z.boolean().optional(),
    configured: z.boolean().optional(),
    state: z.string().nullish(),
    error_message: z.string().nullish(),
    env_vars: z.array(z.looseObject({ key: z.string(), required: z.boolean().optional(), is_set: z.boolean().optional() })).optional(),
  })),
});

export const McpTestSchema = z.looseObject({
  ok: z.boolean(),
  tools: z.array(z.looseObject({ name: z.string() })).optional(),
  error: z.string().nullish(),
});

/** Name of the env variable Hermes stores an MCP bearer token in (`_env_key_for_server`). */
export function mcpTokenEnv(name: string): string {
  return `MCP_${name.toUpperCase().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '')}_API_KEY`;
}

/**
 * GET /api/providers/oauth: providers with an account (subscription). `token_preview` and `source_label` never leave
 * the server; `source` is read to tell how Anthropic is connected, not sent either.
 */
export const OAuthProvidersSchema = z.looseObject({
  providers: z.array(z.looseObject({
    id: z.string(),
    name: z.string().nullish(),
    flow: z.string().nullish(),
    cli_command: z.string().nullish(),
    docs_url: z.string().nullish(),
    disconnectable: z.boolean().nullish(),
    disconnect_hint: z.string().nullish(),
    status: z.looseObject({ logged_in: z.boolean().nullish(), expires_at: z.unknown().optional(), source: z.string().nullish() }).nullish(),
  })),
});
export const OAuthStartSchema = z.looseObject({
  session_id: z.string(),
  user_code: z.string().nullish(),
  verification_url: z.string().nullish(),
  expires_in: z.number().nullish(),
  poll_interval: z.number().nullish(),
});
export const OAuthPollSchema = z.looseObject({
  status: z.string(),
  error_message: z.string().nullish(),
  model: z.string().nullish(),
});
/** GET /api/credentials/pool: API keys and OAuth logins, per provider. `index` is 1-based, as listed. */
export const PoolSchema = z.looseObject({
  providers: z.array(z.looseObject({
    provider: z.string(),
    entries: z.array(z.looseObject({
      index: z.number(),
      id: z.string(),
      label: z.string().nullish(),
      auth_type: z.string().nullish(),
      source: z.string().nullish(),
      last_status: z.string().nullish(),
    })),
  })),
});
/** POST /api/credentials/pool (`add_credential_pool_entry`). */
export const PoolAddSchema = z.looseObject({ ok: z.boolean().optional(), provider: z.string().optional(), count: z.number().optional() });

export const GATEWAY_RESTART_ACTION = 'gateway-restart';

export const configModule: ModuleDef = {
  id: 'config',
  label: 'Configuration',
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
    // Needed by every config write (version check, history copy); its absence hides YAML and history.
    raw: {
      kind: 'read', probe: true, schema: RawConfigSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/config/raw' }],
    },
    modelInfo: { kind: 'read', probe: true, schema: ModelInfoSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/model/info' }] },
    // May write discovered models into the config file: never probed.
    modelOptions: { kind: 'read', probe: false, schema: ModelOptionsSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/model/options' }] },
    auxiliary: { kind: 'read', probe: true, schema: AuxiliarySchema, routes: [{ via: 'dash', method: 'GET', path: '/api/model/auxiliary' }] },
    platforms: { kind: 'read', probe: true, schema: PlatformsSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/messaging/platforms' }] },
    // Declared here too on purpose: availability is computed per module, modules do not depend on each other.
    actionStatus: { kind: 'read', probe: false, schema: ActionStatusSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/actions/{name}/status' }] },
    put: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/config' }] },
    putRaw: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/config/raw' }] },
    setModel: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/model/set' }] },
    putEnv: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/env' }] },
    deleteEnv: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/env' }] },
    addMcp: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/mcp/servers' }] },
    testMcp: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/mcp/servers/{name}/test' }] },
    enableMcp: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/mcp/servers/{name}/enabled' }] },
    removeMcp: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/mcp/servers/{name}' }] },
    restartGateway: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/gateway/restart' }] },
    // provider accounts (OAuth device code) and the credential pool: auth.json of the profile, not the config file
    oauthList: { kind: 'read', probe: true, schema: OAuthProvidersSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/providers/oauth' }] },
    poolList: { kind: 'read', probe: true, schema: PoolSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/credentials/pool' }] },
    oauthPoll: { kind: 'read', probe: false, schema: OAuthPollSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/providers/oauth/{provider}/poll/{session}' }] },
    oauthStart: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/providers/oauth/{provider}/start' }] },
    oauthCancel: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/providers/oauth/sessions/{session}' }] },
    oauthDisconnect: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/providers/oauth/{provider}' }] },
    poolAdd: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/credentials/pool' }] },
    poolRemove: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/credentials/pool/{provider}/{index}' }] },
  },
};
