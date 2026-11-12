import { z } from 'zod';
import type { ModuleDef } from '../types.js';

/** One plugin of `GET /api/dashboard/plugins/hub` (bundled, user, git, pip…). `path` is a host path: never sent on. */
export const HubPluginSchema = z.looseObject({
  name: z.string(),
  version: z.string().nullish(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  runtime_status: z.string().nullish(),
  can_remove: z.boolean().nullish(),
  can_update_git: z.boolean().nullish(),
  auth_required: z.boolean().nullish(),
  auth_command: z.string().nullish(),
  user_hidden: z.boolean().nullish(),
  removed_reason: z.string().nullish(),
});
export const HubSchema = z.looseObject({ plugins: z.array(HubPluginSchema) });

/** One entry of the curated catalog shipped with Hermes (`plugin-catalog/`), pinned to a commit. */
export const CatalogEntrySchema = z.looseObject({
  name: z.string(),
  repo: z.string(),
  sha: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  maintainer: z.string().nullish(),
  tier: z.string().nullish(),
  category: z.string().nullish(),
  requires_hermes: z.string().nullish(),
  docs_url: z.string().nullish(),
  version: z.string().nullish(),
  platforms: z.array(z.string()).nullish(),
  capabilities: z.looseObject({
    provides_tools: z.array(z.string()).nullish(),
    provides_hooks: z.array(z.string()).nullish(),
    provides_middleware: z.array(z.string()).nullish(),
    requires_env: z.array(z.string()).nullish(),
  }).nullish(),
  known_issues: z.array(z.string()).nullish(),
  sha_short: z.string().nullish(),
  installed: z.boolean().nullish(),
  installed_sha: z.string().nullish(),
  update_available: z.boolean().nullish(),
  runtime_status: z.string().nullish(),
});
export const CatalogSchema = z.looseObject({
  entries: z.array(CatalogEntrySchema),
  removed: z.array(z.looseObject({ name: z.string(), reason: z.string().nullish(), date: z.string().nullish() })).nullish(),
  generated_at: z.string().nullish(),
});
export type HermesCatalogEntry = z.infer<typeof CatalogEntrySchema>;

const dash = (method: 'POST' | 'DELETE', path: string) => [{ via: 'dash' as const, method, path }];

/**
 * Agent plugins of the dashboard (lot 8 E: option 51). The mutations take no `profile`: they act on the dashboard's
 * launch home, shared by every profile (and the Hermes venv). Install is synchronous at Hermes (git clone + pip, can
 * take minutes): Intendia runs it as its own background job.
 */
export const pluginsModule: ModuleDef = {
  id: 'plugins',
  label: 'Plugins',
  ops: {
    installed: {
      kind: 'read', required: true, probe: true, schema: HubSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/dashboard/plugins/hub' }],
    },
    catalog: {
      kind: 'read', optional: true, probe: true, schema: CatalogSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/dashboard/plugins/catalog' }],
    },
    install: { kind: 'write', optional: true, routes: dash('POST', '/api/dashboard/agent-plugins/install') },
    enable: { kind: 'write', optional: true, routes: dash('POST', '/api/dashboard/agent-plugins/{name}/enable') },
    disable: { kind: 'write', optional: true, routes: dash('POST', '/api/dashboard/agent-plugins/{name}/disable') },
    remove: { kind: 'write', optional: true, routes: dash('DELETE', '/api/dashboard/agent-plugins/{name}') },
  },
};
