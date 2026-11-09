import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const ProfileSchema = z.looseObject({
  name: z.string(),
  is_default: z.boolean().optional(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  description: z.string().nullish(),
  skill_count: z.number().optional(),
});
export const ProfileListSchema = z.looseObject({ profiles: z.array(ProfileSchema) });

export const agentsModule: ModuleDef = {
  id: 'agents',
  label: 'Agents',
  dashboardPage: '/profiles',
  ops: {
    list: {
      kind: 'read', required: true, probe: true, schema: ProfileListSchema,
      routes: [
        { via: 'dash', method: 'GET', path: '/api/profiles' },
        { via: 'dash', method: 'GET', path: '/api/plugins/kanban/profiles' },
      ],
    },
    create: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/profiles' }] },
    update: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'PATCH', path: '/api/profiles/{name}' },
        { via: 'dash', method: 'PATCH', path: '/api/plugins/kanban/profiles/{name}' },
      ],
    },
    setDescription: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/profiles/{name}/description' }] },
    setModel: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/profiles/{name}/model' }] },
  },
};
