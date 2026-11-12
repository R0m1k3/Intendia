import { z } from 'zod';
import type { ModuleDef } from '../types.js';

export const ProfileSchema = z.looseObject({
  name: z.string(),
  is_default: z.boolean().optional(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  description: z.string().nullish(),
  skill_count: z.number().optional(),
  gateway_running: z.boolean().optional(),
  has_env: z.boolean().optional(),
});
export const ProfileListSchema = z.looseObject({ profiles: z.array(ProfileSchema) });
export const SoulSchema = z.looseObject({ content: z.string().nullish() });
export const ProfileCreatedSchema = z.looseObject({ name: z.string().optional(), model_error: z.string().nullish() });
export const ProfileDeletedSchema = z.looseObject({ ok: z.boolean().optional(), settlement_pending: z.boolean().optional() });
export const DescribeAutoSchema = z.looseObject({ ok: z.boolean(), reason: z.string().nullish(), description: z.string().nullish() });

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
    soul: { kind: 'read', probe: false, schema: SoulSchema, routes: [{ via: 'dash', method: 'GET', path: '/api/profiles/{name}/soul' }] },
    create: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/profiles' }] },
    remove: { kind: 'write', routes: [{ via: 'dash', method: 'DELETE', path: '/api/profiles/{name}' }] },
    setSoul: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/profiles/{name}/soul' }] },
    setModel: { kind: 'write', routes: [{ via: 'dash', method: 'PUT', path: '/api/profiles/{name}/model' }] },
    // auxiliary LLM, up to 60 s at Hermes
    describeAuto: { kind: 'write', routes: [{ via: 'dash', method: 'POST', path: '/api/profiles/{name}/describe-auto' }] },
    // PATCH /api/profiles/{name} renames a profile in Hermes 0.23.0: never used for the description.
    setDescription: {
      kind: 'write',
      routes: [
        { via: 'dash', method: 'PUT', path: '/api/profiles/{name}/description' },
        { via: 'dash', method: 'PATCH', path: '/api/plugins/kanban/profiles/{name}' },
      ],
    },
  },
};
