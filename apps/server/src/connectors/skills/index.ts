import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const SkillSchema = z.looseObject({
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  enabled: z.boolean().optional(),
});

/** Dashboard: bare array. API server /v1/skills: OpenAI-style `{ data: [...] }`. */
export const SkillListSchema = z.union([z.array(SkillSchema), z.looseObject({ data: z.array(SkillSchema) })]);

export const ToolsetListSchema = z.looseObject({
  data: z.array(z.looseObject({ name: z.string(), enabled: z.boolean().optional(), tools: z.array(z.string()).optional() })),
});

export const HubSearchSchema = z.looseObject({
  results: z.array(z.looseObject({ name: z.string(), identifier: z.string().optional(), source: z.string().optional() })),
});

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
    toolsets: {
      kind: 'read', probe: true, schema: ToolsetListSchema,
      routes: [{ via: 'api', method: 'GET', path: '/v1/toolsets', capability: 'toolsets' }],
    },
    hubSearch: {
      kind: 'read', probe: false, schema: HubSearchSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/skills/hub/search' }],
    },
    toggle: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/skills/toggle' }] },
    install: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/skills/hub/install' }] },
    uninstall: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/skills/hub/uninstall' }] },
    update: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/skills/hub/update' }] },
  },
};
