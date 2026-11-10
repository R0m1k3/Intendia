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

export interface FileEntry {
  name: string;
  /** Relative to the workspace. */
  path: string;
  kind: 'file' | 'dir' | 'link';
  target?: 'file' | 'dir';
  outside?: true;
  size: number;
  mtime: number;
}
export interface ShareLink {
  token: string;
  instanceId: string;
  path: string;
  agentPath: string;
  workspace: string | null;
  url: string;
  publicUntil: number | null;
  revoked: boolean;
  createdAt: number;
  exists: boolean;
}
export interface McpInfo {
  url: string;
  token: string;
  publicUrlSet: boolean;
}

const enc = encodeURIComponent;
/** Base path of an Intendia session's routes. */
export interface CronSchedule {
  kind: string;
  minutes: number | null;
  expr: string | null;
  runAt: string | null;
  display: string | null;
}

export interface Cron {
  id: string;
  instanceId: string;
  profile: string;
  name: string;
  prompt: string;
  workspace: { slug: string; name: string | null; folder: string; missing: boolean } | null;
  schedule: CronSchedule;
  enabled: boolean;
  state: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastDeliveryError: string | null;
  failureStreak: number;
  deliver: string | null;
  skills: string[];
  model: string | null;
}

export interface CronRun {
  id: string;
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  costUsd: number | null;
  model: string | null;
}

export interface CronInput {
  name: string;
  prompt: string;
  schedule?: string;
  deliver: string;
  skills: string[];
  model: string | null;
  workspace: string | null;
  paused?: boolean;
}

export interface DeliveryTarget { id: string; name: string }

export interface UpcomingCron {
  instanceId: string;
  instanceLabel: string;
  id: string;
  profile: string;
  name: string;
  nextRunAt: string;
  schedule: CronSchedule;
}

export interface Skill {
  name: string;
  description: string | null;
  category: string | null;
  enabled: boolean | null;
  provenance: string | null;
  usage: number;
  locked: boolean;
}
export interface Toolset {
  name: string;
  label: string;
  description: string | null;
  enabled: boolean | null;
  configured: boolean | null;
  tools: string[];
}
export interface HubResult {
  name: string;
  identifier: string;
  description: string | null;
  source: string | null;
  trust: string | null;
  repo: string | null;
  tags: string[];
  installed: boolean;
}
export interface Scan {
  verdict: string;
  policy: string;
  reason: string | null;
  summary: string | null;
  trust: string | null;
  findings: Record<string, unknown>[];
  counts: Record<string, number>;
}
export interface ActionStatus {
  running: boolean;
  exitCode: number | null;
  lines: string[];
  truncated: boolean;
}

export const sessionPath = (inst: string, id: string) => `/sessions/${enc(inst)}/${enc(id)}`;
const cronsPath = (inst: string) => `/i/${enc(inst)}/crons`;
const cronPath = (inst: string, id: string, profile: string, sub?: string) =>
  `${cronsPath(inst)}/${enc(id)}${sub ? `/${sub}` : ''}?profile=${enc(profile)}`;
/** Per-instance console route with ?profile= (skills, agents). */
const instPath = (inst: string, sub: string, profile?: string, extra?: Record<string, string>) => {
  const q = new URLSearchParams({ ...(profile ? { profile } : {}), ...extra }).toString();
  return `/i/${enc(inst)}/${sub}${q ? `?${q}` : ''}`;
};
const filesPath = (slug: string) => `/workspaces/${enc(slug)}/files`;

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

  tree: (slug: string, path = '') => call<{ path: string; entries: FileEntry[]; truncated: boolean }>('GET', `${filesPath(slug)}/tree?path=${enc(path)}`),
  searchFiles: (slug: string, q: string) => call<{ results: FileEntry[]; truncated: boolean }>('GET', `${filesPath(slug)}/search?q=${enc(q)}`),
  moveFile: (slug: string, from: string, to: string) => call<{ path: string }>('PATCH', `${filesPath(slug)}/move`, { from, to }),
  deleteFile: (slug: string, path: string) => call<{ ok: true }>('DELETE', `${filesPath(slug)}?path=${enc(path)}`),
  saveText: (slug: string, path: string, text: string, mtime: number) => call<{ mtime: number }>('PUT', `${filesPath(slug)}/text`, { path, text, mtime }),
  filesExist: (slug: string, paths: string[]) =>
    call<{ results: Record<string, { path: string; kind: 'file' | 'dir' } | null> }>('POST', `${filesPath(slug)}/exists`, { paths }),
  shareFile: (slug: string, path: string) => call<{ token: string; url: string; publicUntil: number | null }>('POST', `${filesPath(slug)}/share`, { path }),
  links: () => call<{ links: ShareLink[] }>('GET', '/links'),
  setLinkPublic: (token: string, publicUntil: number | null) => call<{ link: ShareLink }>('PATCH', `/links/${enc(token)}`, { publicUntil }),
  revokeLink: (token: string) => call<{ ok: true }>('DELETE', `/links/${enc(token)}`),
  mcp: (inst: string) => call<McpInfo>('GET', `/instances/${enc(inst)}/mcp`),
  rotateMcp: (inst: string) => call<McpInfo>('POST', `/instances/${enc(inst)}/mcp/rotate`, {}),

  crons: (inst: string) => call<{ crons: Cron[] }>('GET', cronsPath(inst)),
  cron: (inst: string, id: string, profile: string) => call<{ cron: Cron }>('GET', cronPath(inst, id, profile)),
  createCron: (inst: string, input: CronInput) => call<{ cron: Cron }>('POST', cronsPath(inst), input),
  updateCron: (inst: string, id: string, profile: string, input: CronInput) => call<{ cron: Cron }>('PUT', cronPath(inst, id, profile), input),
  deleteCron: (inst: string, id: string, profile: string) => call<null>('DELETE', cronPath(inst, id, profile)),
  cronAction: (inst: string, id: string, profile: string, op: 'pause' | 'resume' | 'trigger') =>
    call<{ cron: Cron }>('POST', cronPath(inst, id, profile, op), {}),
  cancelCron: (inst: string, id: string, profile: string) =>
    call<{ cancelled: boolean; detail: string | null }>('POST', cronPath(inst, id, profile, 'cancel'), {}),
  cronRuns: (inst: string, id: string, profile: string) => call<{ runs: CronRun[] }>('GET', cronPath(inst, id, profile, 'runs')),
  cronTargets: (inst: string) => call<{ targets: DeliveryTarget[] }>('GET', `${cronsPath(inst)}/targets`),
  upcomingCrons: () => call<{ upcoming: UpcomingCron[] }>('GET', '/crons/upcoming'),
  profiles: (inst: string) => call<{ profiles: string[] }>('GET', instPath(inst, 'agents/profiles')),
  skills: (inst: string, profile: string) => call<{ skills: Skill[] }>('GET', instPath(inst, 'skills', profile)),
  skillContent: (inst: string, profile: string, name: string) =>
    call<{ name: string; content: string; truncated: boolean }>('GET', instPath(inst, 'skills/content', profile, { name })),
  setSkillEnabled: (inst: string, profile: string, name: string, enabled: boolean) =>
    call<{ skill: Skill }>('PUT', instPath(inst, 'skills/enabled', profile), { name, enabled }),
  toolsets: (inst: string, profile: string) => call<{ toolsets: Toolset[] }>('GET', instPath(inst, 'skills/toolsets', profile)),
  hubOfficial: (inst: string, profile: string) => call<{ results: HubResult[]; timedOut: string[] }>('GET', instPath(inst, 'skills/hub/official', profile)),
  hubSearch: (inst: string, profile: string, q: string) =>
    call<{ results: HubResult[]; timedOut: string[] }>('GET', instPath(inst, 'skills/hub/search', profile, { q })),
  hubScan: (inst: string, profile: string, identifier: string) =>
    call<{ scan: Scan }>('GET', instPath(inst, 'skills/hub/scan', profile, { identifier })),
  installSkill: (inst: string, profile: string, identifier: string, acknowledged: boolean) =>
    call<{ action: string }>('POST', instPath(inst, 'skills/hub/install', profile), { identifier, acknowledged }),
  uninstallSkill: (inst: string, profile: string, name: string) =>
    call<{ action: string }>('POST', instPath(inst, 'skills/hub/uninstall', profile), { name }),
  updateSkills: (inst: string, profile: string) => call<{ action: string }>('POST', instPath(inst, 'skills/hub/update', profile), {}),
  skillAction: (inst: string, action: string) => call<ActionStatus>('GET', instPath(inst, `skills/hub/actions/${enc(action)}`)),
};

/** URL of a file's content (preview, download); served with CSP sandbox. */
export const rawUrl = (slug: string, path: string, download = false) =>
  `/x${filesPath(slug)}/raw?path=${enc(path)}${download ? '&download=1' : ''}`;

/** URL of a run's SSE stream (EventSource). */
export const runEventsUrl = (inst: string, id: string, runId: string) => `/x${sessionPath(inst, id)}/runs/${enc(runId)}/events`;
