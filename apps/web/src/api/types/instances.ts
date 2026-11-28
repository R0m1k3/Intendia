export type ModuleState = 'full' | 'readonly' | 'unavailable';
export type ModuleId = 'health' | 'chat' | 'sessions' | 'crons' | 'skills' | 'config' | 'agents' | 'kanban' | 'git' | 'monitor' | 'memory' | 'plugins';
export interface ResolvedOp {
  ok: boolean;
  route?: { via: 'api' | 'dash'; method: string; path: string };
  notes: string[];
  /** Failed op: its last probe failed with a passing error (outage, timeout). */
  transient?: true;
  /** Failed op: refused at once by the server (side down, key or token refused). */
  code?: 'hermes_unreachable' | 'dash_token_refused' | 'api_key_refused';
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
  /** `auth`: key (or token) checked by the last full check: `refused` = Hermes answered 401/403. */
  api: { reachable: boolean; error?: string; auth?: 'ok' | 'refused' | 'unknown' };
  dash: { configured: boolean; reachable: boolean; error?: string; openapi: boolean; auth?: 'ok' | 'refused' | 'unknown' };
  /** A side of Hermes did not answer at the last check, since `since` (ms); rechecked by itself. */
  outage?: { since: number; api: boolean; dash: boolean };
  modules: ModuleReport[];
  /** Root of the workspaces on this instance, or why the Files module cannot be used. */
  files?: { workspaceRoot: string | null; reason: string | null; transient?: true };
  /** `session.stats` of the dashboard WebSocket (exact context, quotas); absent = not checked yet. */
  socket?: { sessionStats: boolean; oneshot?: boolean; /** credential vault (`vault.*`); absent = not checked yet */ vault?: boolean; note: string };
  /** Ops this Intendia knows that the report has not checked yet (`module.op`; report saved by an older version). */
  unchecked?: string[];
  /** Last full check failed (short message). */
  checkError?: string;
  /** A full check is running. */
  checking?: boolean;
}
/** Composer gauge: `max` = context size of the model; `exact`/`quota` from the dashboard WebSocket only. */
export interface SessionUsage {
  max: number | null;
  exact: { used: number; max: number } | null;
  quota: { label: string | null; usedPercent: number; resetsAt: number | null } | null;
}
export interface PublicInstance {
  id: string;
  label: string;
  api: string;
  dashboard: string | null;
  dashboardLink: string | null;
  /** Root of the workspaces (Hermes' managed files root) read at the last check, or why there is none; null = not checked. */
  files: { workspaceRoot: string | null; reason: string | null } | null;
  profiles: string[];
  source: 'env' | 'db';
}
export interface SetupState {
  needsPassword: boolean;
  needsInstance: boolean;
  declarativeInstances: boolean;
  authenticated: boolean;
  version: string;
}
export interface InstanceInput {
  id: string;
  label: string;
  api: string;
  apiKey: string;
  dashboard?: string;
  dashboardToken?: string;
  dashboardLink?: string;
}
/** Change of a saved instance: absent or empty = unchanged, null = removed; profileKeys merged by name (null removes). */
export interface InstancePatch extends Partial<Omit<InstanceInput, 'id' | 'dashboard' | 'dashboardLink'>> {
  dashboard?: string | null;
  dashboardLink?: string | null;
  profileKeys?: Record<string, string | null>;
}
export interface Workspace {
  slug: string;
  name: string;
  instanceId: string;
  profile: string | null;
  /** Last model / effort chosen in one of its sessions (start of the next ones); not a setting. */
  model: string | null;
  /** Provider of `model` (picker group); null = model sent alone. */
  modelProvider: string | null;
  effort: string | null;
  createdAt: number;
  /** Non-archived sessions (GET /x/workspaces only). */
  sessionCount?: number;
}
