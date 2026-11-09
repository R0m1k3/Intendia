import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const SkillSchema = z.looseObject({
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  enabled: z.boolean().optional(),
  locked: z.boolean().optional(),
  usage: z.number().optional(),
  provenance: z.string().optional(),
});
export type HermesSkill = z.infer<typeof SkillSchema>;

/** Dashboard: bare array. API server /v1/skills: OpenAI-style `{ data: [...] }`. */
export const SkillListSchema = z.union([z.array(SkillSchema), z.looseObject({ data: z.array(SkillSchema) })]);

export const ToolsetSchema = z.looseObject({
  name: z.string(),
  label: z.string().nullish(),
  description: z.string().nullish(),
  enabled: z.boolean().optional(),
  available: z.boolean().optional(),
  configured: z.boolean().optional(),
  tools: z.array(z.string()).optional(),
});
/** Dashboard /api/tools/toolsets: bare array. API server /v1/toolsets: `{ data: [...] }`. */
export const ToolsetListSchema = z.union([z.array(ToolsetSchema), z.looseObject({ data: z.array(ToolsetSchema) })]);

export const HubResultSchema = z.looseObject({
  name: z.string(),
  identifier: z.string(),
  description: z.string().nullish(),
  source: z.string().nullish(),
  trust_level: z.string().nullish(),
  repo: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  category: z.string().nullish(),
  installed: z.boolean().optional(),
});
export type HermesHubResult = z.infer<typeof HubResultSchema>;

export const HubSearchSchema = z.looseObject({
  results: z.array(HubResultSchema),
  timed_out: z.array(z.string()).optional(),
  installed: z.record(z.string(), z.unknown()).optional(),
});
export const HubOfficialSchema = z.looseObject({ skills: z.array(HubResultSchema) });

export const ScanSchema = z.looseObject({
  verdict: z.string(),
  policy: z.string(),
  policy_reason: z.string().nullish(),
  summary: z.string().nullish(),
  trust_level: z.string().nullish(),
  findings: z.array(z.looseObject({})).optional(),
  severity_counts: z.record(z.string(), z.number()).optional(),
});
export type HermesScan = z.infer<typeof ScanSchema>;

export const ContentSchema = z.looseObject({ name: z.string(), content: z.string() });
export const ActionStartSchema = z.looseObject({ name: z.string().min(1) });
export const ActionStatusSchema = z.looseObject({
  running: z.boolean(),
  exit_code: z.number().nullable(),
  lines: z.array(z.string()),
});

export const UPDATE_ACTION = 'skills-update';

/**
 * Name Hermes gives a hub action (`_hub_action_name` in web_server_profiles.py, 0.23.0), used only
 * to refuse a second start while the first runs. If Hermes changes the rule, the status read answers 404
 * and the start goes on without the check.
 */
export function actionName(verb: 'install' | 'uninstall', key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill';
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 8);
  return `skills-${verb}-${slug}-${digest}`;
}

// Hermes 0.23.0 ships a broken GET /v1/skills (HTTP 500, TypeError in find_all_skills):
// the dashboard list is preferred, the API server stays as a fallback.
export const skillsModule: ModuleDef = {
  id: 'skills',
  label: 'Skills',
  dashboardPage: '/skills',
  ops: {
    list: {
      kind: 'read', required: true, probe: true, schema: SkillListSchema,
      routes: [
        { via: 'dash', method: 'GET', path: '/api/skills' },
        { via: 'api', method: 'GET', path: '/v1/skills', capability: 'skills', feature: 'skills_api' },
      ],
    },
    // the dashboard serves every profile without a per-profile API key
    toolsets: {
      kind: 'read', probe: true, schema: ToolsetListSchema,
      routes: [
        { via: 'dash', method: 'GET', path: '/api/tools/toolsets' },
        { via: 'api', method: 'GET', path: '/v1/toolsets', capability: 'toolsets' },
      ],
    },
    content: { kind: 'read', probe: false, schema: ContentSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/skills/content' }] },
    hubOfficial: { kind: 'read', probe: false, schema: HubOfficialSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/skills/hub/official' }] },
    hubSearch: { kind: 'read', probe: false, schema: HubSearchSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/skills/hub/search' }] },
    // downloads the bundle: never probed
    hubScan: { kind: 'read', probe: false, schema: ScanSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/skills/hub/scan' }] },
    actionStatus: { kind: 'read', probe: false, schema: ActionStatusSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/actions/{name}/status' }] },
    toggle: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/skills/toggle' }] },
    install: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/skills/hub/install' }] },
    uninstall: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/skills/hub/uninstall' }] },
    update: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/skills/hub/update' }] },
  },
};
