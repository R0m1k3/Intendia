import { z } from 'zod';
import type { ModuleDef } from '../types.js';

/** A memory card of the learning graph: one entry of MEMORY.md (`memory`) or USER.md (`profile`). */
export const MemoryCardSchema = z.looseObject({
  source: z.string(),
  timestamp: z.number().nullish(),
  title: z.string().nullish(),
  body: z.string().nullish(),
  fingerprint: z.string().nullish(),
});
export const GraphNodeSchema = z.looseObject({
  id: z.string(),
  label: z.string().nullish(),
  kind: z.string(),
  timestamp: z.number().nullish(),
  category: z.string().nullish(),
  useCount: z.number().nullish(),
  state: z.string().nullish(),
  createdBy: z.string().nullish(),
  pinned: z.boolean().nullish(),
  memorySource: z.string().nullish(),
});
export const GraphSchema = z.looseObject({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(z.looseObject({ source: z.string(), target: z.string() })).nullish(),
  memory: z.array(MemoryCardSchema).nullish(),
  stats: z.looseObject({
    nodes: z.number().nullish(), related_edges: z.number().nullish(), isolated_pct: z.number().nullish(),
    learned_skills: z.number().nullish(), memory_nodes: z.number().nullish(),
  }).nullish(),
});
export type HermesGraph = z.infer<typeof GraphSchema>;
/** `GET /api/memory`: the external provider (`active`, "" = built-in only) and the size of the two files in bytes. */
export const MemoryStatusSchema = z.looseObject({
  active: z.string().nullish(),
  builtin_files: z.looseObject({ memory: z.number().nullish(), user: z.number().nullish() }).nullish(),
});
export const NodeSchema = z.looseObject({ kind: z.string().nullish(), id: z.string().nullish(), content: z.string() });

/**
 * Built-in memory and learning graph of the dashboard (lot 8 D: options 44, 45). Memory ids are
 * `memory:<memory|profile>:<index>:<sha256 of the entry, 12>`; Hermes resolves them by text and says "stale" when
 * the entry changed.
 */
export const memoryModule: ModuleDef = {
  id: 'memory',
  label: 'Mémoire',
  ops: {
    graph: {
      kind: 'read', required: true, probe: true, schema: GraphSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/learning/graph' }],
    },
    status: {
      kind: 'read', optional: true, probe: true, schema: MemoryStatusSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/memory' }],
    },
    node: {
      kind: 'read', optional: true, probe: false, schema: NodeSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/learning/node' }],
    },
    putNode: { kind: 'write', optional: true, routes: [{ via: 'dash', method: 'PUT', path: '/api/learning/node' }] },
    deleteNode: { kind: 'write', optional: true, routes: [{ via: 'dash', method: 'DELETE', path: '/api/learning/node' }] },
  },
};
