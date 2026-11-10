// Typed client for the Intendia server (/x/*). Mirrors apps/server/src/connectors/types.ts.

export type ModuleState = 'full' | 'readonly' | 'unavailable';
export type ModuleId = 'health' | 'chat' | 'sessions' | 'crons' | 'skills' | 'config' | 'agents' | 'kanban';

export interface ResolvedOp {
  ok: boolean;
  route?: { via: 'api' | 'dash'; method: string; path: string };
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
}
export interface PublicInstance {
  id: string;
  label: string;
  api: string;
  dashboard: string | null;
  dashboardLink: string | null;
  mount: string;
  agentMount: string;
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
  mount?: string;
}

export interface Workspace {
  slug: string;
  name: string;
  instanceId: string;
  profile: string | null;
  model: string | null;
  createdAt: number;
}
export interface Session {
  id: string;
  instanceId: string;
  workspace: string;
  title: string | null;
  archived: boolean;
  lastRunId: string | null;
  lastActiveAt: number | null;
  createdAt: number;
}
export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: { name: string; arguments: string }[];
  /** seconds */
  timestamp: number | null;
}
export interface RunStatus {
  status: string;
  /** seconds */
  createdAt: number | null;
  output: string | null;
  error: string | null;
}
export interface OtherSession {
  id: string;
  source: string | null;
  title: string | null;
  preview: string | null;
  startedAt: number | null;
  lastActive: number | null;
  messageCount: number | null;
}
export interface ModelOptions {
  model?: string | null;
  provider?: string | null;
  providers: { slug: string; name?: string; authenticated?: boolean; models?: unknown[] }[];
}
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

const enc = encodeURIComponent;
/** Base path of an Intendia session's routes. */
export const sessionPath = (inst: string, id: string) => `/sessions/${enc(inst)}/${enc(id)}`;

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly data?: unknown) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/x${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Intendia': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') ? data.error : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const api = {
  setup: () => call<SetupState>('GET', '/setup'),
  setPassword: (code: string, password: string) => call<{ ok: true }>('POST', '/setup/password', { code, password }),
  login: (password: string) => call<{ ok: true }>('POST', '/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/logout', {}),
  instances: () => call<{ declarative: boolean; instances: PublicInstance[] }>('GET', '/instances'),
  testInstance: (i: InstanceInput) => call<CompatReport>('POST', '/instances/test', i),
  saveInstance: (i: InstanceInput) => call<{ instance: PublicInstance; report: CompatReport }>('POST', '/instances', i),
  removeInstance: (id: string) => call<{ ok: true }>('DELETE', `/instances/${encodeURIComponent(id)}`),
  compat: () => call<{ reports: CompatReport[] }>('GET', '/compat'),
  recheck: (id: string) => call<CompatReport>('POST', `/compat/${encodeURIComponent(id)}/check`),

  workspaces: () => call<{ workspaces: Workspace[] }>('GET', '/workspaces'),
  workspace: (slug: string) => call<{ workspace: Workspace }>('GET', `/workspaces/${enc(slug)}`),
  createWorkspace: (w: { slug: string; name: string; instanceId: string; profile?: string | null; model?: string | null }) =>
    call<{ workspace: Workspace }>('POST', '/workspaces', w),
  updateWorkspace: (slug: string, patch: { name?: string; model?: string | null }) => call<{ workspace: Workspace }>('PATCH', `/workspaces/${enc(slug)}`, patch),
  agentsMd: (slug: string) => call<{ text: string }>('GET', `/workspaces/${enc(slug)}/agents-md`),
  saveAgentsMd: (slug: string, text: string) => call<{ ok: true }>('PUT', `/workspaces/${enc(slug)}/agents-md`, { text }),
  sessions: (slug: string, archived = false) => call<{ sessions: Session[] }>('GET', `/workspaces/${enc(slug)}/sessions${archived ? '?archived=1' : ''}`),
  createSession: (slug: string) => call<{ session: Session }>('POST', `/workspaces/${enc(slug)}/sessions`),
  session: (inst: string, id: string) => call<{ session: Session; workspace: Workspace; profile: string }>('GET', sessionPath(inst, id)),
  updateSession: (inst: string, id: string, patch: { title?: string | null; archived?: boolean }) =>
    call<{ session: Session }>('PATCH', sessionPath(inst, id), patch),
  deleteSession: (inst: string, id: string) => call<{ ok: true }>('DELETE', sessionPath(inst, id)),
  messages: (inst: string, id: string) => call<{ messages: ChatMessage[] }>('GET', `${sessionPath(inst, id)}/messages`),
  send: (inst: string, id: string, input: string) => call<{ runId: string; session: Session }>('POST', `${sessionPath(inst, id)}/runs`, { input }),
  runStatus: (inst: string, id: string, runId: string) => call<RunStatus>('GET', `${sessionPath(inst, id)}/runs/${enc(runId)}`),
  stop: (inst: string, id: string, runId: string) => call<unknown>('POST', `${sessionPath(inst, id)}/runs/${enc(runId)}/stop`, {}),
  approve: (inst: string, id: string, runId: string, choice: ApprovalChoice, requestId?: string) =>
    call<unknown>('POST', `${sessionPath(inst, id)}/runs/${enc(runId)}/approval`, { choice, requestId }),
  models: (inst: string, profile = 'default') => call<ModelOptions>('GET', `/i/${enc(inst)}/models?profile=${enc(profile)}`),
  otherSessions: (inst: string, profile = 'default', offset = 0) =>
    call<{ sessions: OtherSession[]; hasMore: boolean; nextOffset: number }>('GET', `/i/${enc(inst)}/other-sessions?profile=${enc(profile)}&offset=${offset}`),
  externalMessages: (inst: string, id: string, profile = 'default') =>
    call<{ messages: ChatMessage[] }>('GET', `/i/${enc(inst)}/external/${enc(id)}/messages?profile=${enc(profile)}`),
};

/** URL of a run's SSE stream (EventSource). */
export const runEventsUrl = (inst: string, id: string, runId: string) => `/x${sessionPath(inst, id)}/runs/${enc(runId)}/events`;
