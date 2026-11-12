import type { z } from 'zod';
import type { Method, Via } from '../hermes/http.js';

export type ModuleId = 'health' | 'chat' | 'sessions' | 'crons' | 'skills' | 'config' | 'agents' | 'kanban' | 'files' | 'git';
export type ModuleState = 'full' | 'readonly' | 'unavailable';

/**
 * One possible way to perform an operation. An operation lists its routes by preference;
 * the compatibility engine keeps the first one the instance actually offers.
 */
export interface RouteDef {
  via: Via;
  method: Method;
  /** Default path; for `via: 'api'` with a `capability`, the path announced by /v1/capabilities wins. */
  path: string;
  /** Key in /v1/capabilities `endpoints` (API server only). */
  capability?: string;
  /** Feature flag in /v1/capabilities `features` that must not be false. */
  feature?: string;
}

export interface OpDef {
  kind: 'read' | 'write';
  /** Without this operation the module cannot work at all. */
  required?: boolean;
  /**
   * An option of the module (e.g. a dashboard route): missing, it does not change the module's state, only its
   * feature is hidden.
   */
  optional?: true;
  routes: RouteDef[];
  /** Response schema: tolerant (looseObject), only the fields Intendia reads. */
  schema?: z.ZodType;
  /**
   * Read operations without path parameters are called during the compatibility test.
   * Set false for reads that are expensive or need parameters.
   */
  probe?: boolean;
  /** Query parameters used during the probe. */
  probeQuery?: Record<string, string>;
}

export interface ModuleDef {
  id: ModuleId;
  label: string;
  /** Path of the equivalent page on the official dashboard, for the fallback link. */
  dashboardPage?: string;
  ops: Record<string, OpDef>;
}

export interface ResolvedOp {
  ok: boolean;
  route?: { via: Via; method: Method; path: string };
  /** Why the op is not available (or why a preferred route was skipped). */
  notes: string[];
}

export interface ModuleReport {
  id: ModuleId;
  label: string;
  state: ModuleState;
  reasons: string[];
  ops: Record<string, ResolvedOp>;
  dashboardLink?: string;
}

export interface CompatReport {
  instanceId: string;
  checkedAt: number;
  hermesVersion: string | null;
  api: { reachable: boolean; error?: string };
  dash: { configured: boolean; reachable: boolean; error?: string; openapi: boolean };
  modules: ModuleReport[];
  /**
   * Root of the workspaces on this instance (the dashboard's managed files root, `locked_root`), or why the
   * Files module cannot be used. Absent in reports saved before Intendia 0.0.4 (= not checked yet).
   */
  files?: { workspaceRoot: string | null; reason: string | null };
  /** `session.stats` of the dashboard WebSocket (context, quotas). Absent in reports saved before Intendia 0.0.7. */
  socket?: { sessionStats: boolean; note: string; /** `llm.oneshot` (titles by AI); absent before Intendia 0.0.12. */ oneshot?: boolean };
}
