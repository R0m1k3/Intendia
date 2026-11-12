// Typed client for the Intendia server (/x/*). Mirrors apps/server/src/connectors/types.ts.

export type ModuleState = 'full' | 'readonly' | 'unavailable';
export type ModuleId = 'health' | 'chat' | 'sessions' | 'crons' | 'skills' | 'config' | 'agents' | 'kanban' | 'git' | 'monitor';

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
  /** Root of the workspaces on this instance, or why the Files module cannot be used. */
  files?: { workspaceRoot: string | null; reason: string | null };
  /** `session.stats` of the dashboard WebSocket (exact context, quotas); absent = not checked yet. */
  socket?: { sessionStats: boolean; oneshot?: boolean; note: string };
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
export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
/** One run started from Intendia: options asked for, then what Hermes reported (times in ms). */
export interface RunStat {
  runId: string;
  status: string;
  requestedModel: string | null;
  requestedEffort: string | null;
  servedModel: string | null;
  startedAt: number;
  endedAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  /** Runs covered by costUsd (more than 1: sent while the previous cost was settling, whose own cost is unknown). */
  costRuns: number;
  /** False while Hermes may still write the cost (re-read for COST_SETTLE_MS after the end). */
  costFinal: boolean;
  /** approvals Intendia gave by itself (« Sans confirmation ») */
  autoApproved?: number;
}
export interface PersonalityItem { value: string; label: string; source: 'hermes' | 'intendia' }
export interface ModelPin { provider: string | null; model: string }
export interface RunMode { id: string; name: string; model: string | null; provider: string | null; effort: Effort | null; personality: string | null }
export type PromptKind = 'prompt' | 'personality';
export interface Prompt { id: string; kind: PromptKind; title: string; body: string; createdAt: number; updatedAt: number }
export interface ExtractResult { folder: string; count: number; skipped: { path: string; reason: string }[]; partial: boolean }

export interface Session {
  id: string;
  instanceId: string;
  workspace: string;
  title: string | null;
  archived: boolean;
  lastRunId: string | null;
  lastActiveAt: number | null;
  createdAt: number;
  /** null = Hermes default ("Auto") */
  model: string | null;
  /** Provider of `model` (picker group), sent with it; null = model sent alone. */
  modelProvider: string | null;
  effort: Effort | null;
  /** First in the lists (kept by Intendia only). */
  pinned: boolean;
  /** Copy of another session (its id) or "import:<key>". */
  copiedFrom: string | null;
  /** The session this one replaced (edit, retry, undo, clear), restorable for 10 s. */
  replacesId: string | null;
  /** 'hermes:<name>' | 'intendia:<prompt id>' | null */
  personality?: string | null;
  /** « Sans confirmation »: Intendia approves the actions of its runs */
  autoApprove?: boolean;
  /** profile chosen for this session (null = the workspace's) */
  profile?: string | null;
}
/** A truncated copy: `before` = Hermes row id of the user message to cut before, 0 = nothing kept, null = all. */
export interface RewriteResult { session: Session; replaced?: string; undoUntil?: number | null }
export type BulkAction = 'archive' | 'unarchive' | 'pin' | 'unpin' | 'delete' | 'move';
export interface BulkResult { id: string; ok: boolean; error?: string }
export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: { name: string; arguments: string }[];
  /** seconds */
  timestamp: number | null;
  /** given to the agent during a run (reorientation) */
  steer?: true;
}
export interface RunStatus {
  status: string;
  /** seconds */
  createdAt: number | null;
  output: string | null;
  error: string | null;
  /** reorientation Hermes did not give the agent before the end */
  pendingSteer?: string | null;
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
/** A line of the home page's recent sessions (GET /x/sessions/recent). */
export interface RecentSession {
  kind: 'intendia' | 'hermes';
  instanceId: string;
  profile: string;
  id: string;
  /** "intendia", else Hermes' source (telegram, cron, cli, api_server…) or null */
  source: string | null;
  title: string;
  sub: string;
  workspace: string | null;
  /** ms */
  at: number;
  /** Search hit in the messages (hit between `>>>` and `<<<`); null outside a search. */
  snippet: string | null;
}
export type SessionSource = 'all' | 'intendia' | 'cli' | 'telegram' | 'discord' | 'cron' | 'kanban';
export const SESSION_SOURCES: SessionSource[] = ['all', 'intendia', 'cli', 'telegram', 'discord', 'cron', 'kanban'];
export interface SessionErrors { errors: { instance: string; message: string }[] }
/**
 * Models of the chat's picker for one agent (instance + profile), one group per provider with a key: the models
 * declared in Hermes for it (`declared`), else its whole catalogue. `managed` = editable in the Modèles tab.
 */
export interface ChatModelGroup { provider: string; name: string; models: string[]; declared: boolean }
export interface ChatModelList {
  auto: { model: string; provider: string | null } | null;
  groups: ChatModelGroup[];
  managed: boolean;
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
  /** Instance root listing only: top-level folder that is a workspace of this instance (its slug). */
  workspace?: string;
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
/** share_file in Hermes (apps/server/src/mcp/connect.ts). */
export type McpState = 'connected' | 'stale' | 'manual' | 'other_url' | 'plugin' | 'missing' | 'unknown';
export interface McpTest { ok: boolean; tools: string[]; error?: string }
export interface McpInfo {
  url: string;
  token: string;
  publicUrlSet: boolean;
  state: McpState;
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

/** An active cron of any instance (home page: next runs, timeline, failures, counter). */
export interface OverviewCron {
  instanceId: string;
  instanceLabel: string;
  id: string;
  profile: string;
  name: string;
  schedule: CronSchedule;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  /** The cron's own IANA time zone, null = Hermes' zone. */
  timezone: string | null;
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

// ---------------------------------------------------------------- Hermes configuration (phase 6)

export interface ConfigField { type?: string; description?: string; category?: string; options?: unknown[]; clearable?: boolean; searchable?: boolean }
export interface ConfigForm { values: Record<string, unknown>; schema: Record<string, ConfigField>; categories: string[]; version: string | null }
export interface ConfigVersion { id: number; createdAt: number; source: string; readable: boolean }
export interface ModelProvider {
  slug: string; name: string; authenticated: boolean; keyEnv: string | null; models: string[]; warning: string | null;
  /** Models declared in Hermes for this provider (what the chat offers; none = whole catalogue). */
  declared: string[];
  /** The declaration can be changed from Intendia (else: YAML tab). */
  editable: boolean;
}
export interface ConfigModels {
  main: { provider: string; model: string; contextLength: number | null };
  providers: ModelProvider[];
  auxiliary: { task: string; label: string | null; provider: string; model: string }[];
  version: string | null;
}
/** Provider account (subscription) of an agent: connected by a device code, or by a command on the Hermes machine. */
export interface ProviderAccount {
  id: string; name: string; flow: 'device_code' | 'external';
  cliCommand: string | null; docsUrl: string | null;
  disconnectable: boolean; disconnectHint: string | null;
  connected: boolean; expiresAt: string | null;
  /** Anthropic only: `token` = setup-token variable, `api_key` = a paid API key is used, `hermes` = login on its machine. */
  via?: 'token' | 'api_key' | 'hermes' | null;
}
/** API key of the credential pool (never its value). `source`: `manual`, or `env:NAME` for a key variable. */
/** Custom endpoint of the config file: `providers.<slug>` (v12) or an old `custom_providers` entry (slug null). */
export interface CustomProvider {
  slug: string | null;
  name: string;
  baseUrl: string;
  model: string | null;
  key: { kind: 'env'; name: string; set: boolean } | { kind: 'inline' } | null;
  legacy: boolean;
}
export interface ProviderKey { provider: string; id: string; label: string; source: string; lastStatus: string | null }
export interface ProvidersInfo {
  accounts: ProviderAccount[] | null;
  keys: ProviderKey[] | null;
  keyProviders: { slug: string; name: string }[];
}
export interface ConnectStart { sessionId: string; userCode: string; verificationUrl: string; pollInterval: number | null; expiresIn: number | null }
export interface ConnectPoll { status: string; error: string | null; model: string | null }

export interface EnvVar {
  key: string; isSet: boolean; description: string | null; category: string | null; isPassword: boolean;
  advanced: boolean; channelManaged: boolean; provider: string | null; custom: boolean;
}
export interface McpServer {
  name: string; transport: string | null; url: string | null; command: string | null; args: string[];
  env: { key: string; isSet: boolean }[]; auth: string | null; enabled: boolean; tools: string[]; source: string | null; plugin: string | null;
}
export interface McpInput { name: string; url?: string; token?: string; command?: string; args?: string[]; env?: Record<string, string> }
export interface Platform {
  id: string; name: string; enabled: boolean; configured: boolean; state: string | null; errorMessage: string | null;
  env: { key: string; isSet: boolean; required: boolean }[];
}
export type GatewayAction = 'start' | 'stop' | 'restart';
export interface CreateAgentInput {
  name: string; description?: string; cloneFrom?: string;
  /** with cloneFrom: memories and sessions too */
  cloneAll?: boolean; noSkills?: boolean; soul?: string; provider?: string; model?: string;
}
export interface RestartStatus { running: boolean; exitCode: number | null; lines: string[]; truncated: boolean }
export interface WriteResult { version: string | null }
export interface ModelInput { scope: 'main' | 'auxiliary'; provider: string; model: string; task?: string; confirm?: boolean; version: string }

export interface Agent {
  name: string;
  isDefault: boolean;
  description: string;
  model: string | null;
  provider: string | null;
  skillCount: number | null;
  gatewayRunning: boolean | null;
  /** Intendia can chat with it (default: instance key; others: profileKeys[name]) */
  hasKey: boolean;
  /** active kanban workers assigned to it; null when the kanban cannot be read */
  workers: number | null;
}
export interface KanbanWorker {
  instance: string;
  board: string;
  runId: number;
  taskId: string;
  taskTitle: string | null;
  assignee: string | null;
  /** seconds */
  startedAt: number | null;
}
export interface AgentDetail extends Agent {
  soul: string | null;
  soulTruncated: boolean;
  activeWorkers: KanbanWorker[];
}
export interface PendingApproval {
  key: string;
  instanceId: string;
  instanceLabel: string;
  workspace: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  /** approval: allow a command; clarify: a question of the agent, answered with text. */
  kind: 'approval' | 'clarify';
  requestId: string | null;
  question: string | null;
  multiSelect: boolean;
  command: string | null;
  description: string | null;
  choices: string[];
  canAnswer: boolean;
}

export interface ActiveRun {
  instance: string;
  workspace: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  status: string;
  profile: string;
  /** ms */
  lastActiveAt: number;
}
export interface Activity {
  runs: ActiveRun[];
  workers: KanbanWorker[];
  errors: { instance: string; message: string }[];
}
export interface KanbanBoard { slug: string; name: string; total: number }
export interface KanbanTask {
  id: string;
  title: string;
  status: string;
  body: string;
  assignee: string | null;
  priority: number | null;
  commentCount: number;
  parents: number;
  children: number;
  progress: { done: number; total: number } | null;
  runId: number | null;
  error: string | null;
  summary: string | null;
  workspace: { slug: string; name: string; folder: string } | null;
  /** seconds */
  createdAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
}
export interface KanbanColumn { key: string; label: string; dragTarget: boolean; tasks: KanbanTask[] }
export interface KanbanBoardView { board: string; columns: KanbanColumn[]; latestEventId: number | null }
export interface KanbanWorkflow { columns: { key: string; label: string; dragTarget: boolean }[]; manual: Record<string, string[]> }
export interface KanbanTaskRef { id: string; title: string | null; status: string | null }
export interface KanbanTaskDetail {
  task: KanbanTask;
  blockReason: string | null;
  comments: { id: number; author: string | null; body: string; createdAt: number | null }[];
  events: { id: number; kind: string; createdAt: number | null }[];
  attachments: { id: number; filename: string; size: number | null; contentType: string | null }[];
  parents: KanbanTaskRef[];
  children: KanbanTaskRef[];
  runs: { id: number; profile: string | null; status: string | null; outcome: string | null; startedAt: number | null; endedAt: number | null; error: string | null; summary: string | null }[];
}
export interface KanbanOrchestration {
  orchestratorProfile: string | null;
  defaultAssignee: string | null;
  autoDecompose: boolean;
  autoPromoteChildren: boolean;
  activeProfile: string | null;
}
export type KanbanStart = 'scheduled' | 'ready' | 'triage';
export interface KanbanTaskInput { title: string; body?: string; assignee?: string | null; priority?: number | null; start?: KanbanStart; workspace?: string | null }
export interface KanbanTaskPatch { status?: string; assignee?: string | null; priority?: number | null; title?: string; body?: string; blockReason?: string }
export const kanbanPath = (inst: string, sub: string, board?: string, extra: Record<string, string> = {}) =>
  `/i/${encodeURIComponent(inst)}/kanban/${sub}${board || Object.keys(extra).length ? `?${new URLSearchParams({ ...(board ? { board } : {}), ...extra })}` : ''}`;

export const sessionPath = (inst: string, id: string) => `/sessions/${enc(inst)}/${enc(id)}`;
const cronsPath = (inst: string) => `/i/${enc(inst)}/crons`;
const cronPath = (inst: string, id: string, profile: string, sub?: string) =>
  `${cronsPath(inst)}/${enc(id)}${sub ? `/${sub}` : ''}?profile=${enc(profile)}`;
/** Per-instance console route with ?profile= (skills, agents). */
const instPath = (inst: string, sub: string, profile?: string, extra?: Record<string, string>) => {
  const q = new URLSearchParams({ ...(profile ? { profile } : {}), ...extra }).toString();
  return `/i/${enc(inst)}/${sub}${q ? `?${q}` : ''}`;
};
/** A folder listing; `agentRoot` = the listed root as the agent sees it (absolute). */
export interface FileTree { path: string; entries: FileEntry[]; truncated: boolean; agentRoot?: string }
const filesPath = (slug: string) => `/workspaces/${enc(slug)}/files`;
const gitPath = (slug: string) => `/workspaces/${enc(slug)}/git`;

export interface GitFile {
  /** Relative to the repository; a folder not tracked yet ends with `/`. */
  path: string;
  /** M, A, D, R, C, U (conflict), ? (untracked). */
  status: string;
  staged: boolean;
  /** null: unknown (Hermes' status lists 200 files at most). */
  unstaged: boolean | null;
  conflicted: boolean;
  added: number;
  removed: number;
  dir: boolean;
  sensitive: boolean;
}
export interface GitStatus {
  repo: string;
  branch: string | null;
  defaultBranch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number };
  files: GitFile[];
  truncated: boolean;
}
export type GitDiffWhich = 'staged' | 'unstaged' | 'all';

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

export interface UsageTotals {
  input: number | null; output: number | null; cacheRead: number | null; reasoning: number | null;
  estimatedCost: number | null; actualCost: number | null; sessions: number | null; apiCalls: number | null;
}
export interface UsageDay { day: string; estimatedCost: number | null; actualCost: number | null; input: number | null; output: number | null; sessions: number | null; apiCalls: number | null }
export interface PublicUsage {
  days: number;
  totals: UsageTotals;
  daily: UsageDay[];
  byModel: { model: string; input: number | null; output: number | null; estimatedCost: number | null; sessions: number | null; apiCalls: number | null }[];
  tools: { name: string; count: number | null; percentage: number | null }[];
  skills: { name: string; count: number | null; percentage: number | null }[];
  sources: Record<string, number> | null;
  partial: string[];
}
export interface LogQuery { file: string; lines: number; level?: string; component?: string; search?: string }
export interface PublicLogs { file: string; lines: string[]; unredacted: boolean }
export interface PublicSystemStats {
  psutil: boolean; hostname: string | null; system: string | null; release: string | null; arch: string | null;
  hermesVersion: string | null; pythonVersion: string | null; cpuCount: number | null; cpuPercent: number | null;
  loadAvg: number[] | null; uptimeSeconds: number | null;
  memory: { total: number | null; used: number | null; available: number | null; percent: number | null } | null;
  disk: { total: number | null; used: number | null; free: number | null; percent: number | null } | null;
  process: { rss: number | null; threads: number | null } | null;
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
  renameInstance: (id: string, label: string) => call<{ instance: PublicInstance }>('PATCH', `/instances/${encodeURIComponent(id)}`, { label }),
  compat: () => call<{ reports: CompatReport[] }>('GET', '/compat'),
  recheck: (id: string) => call<CompatReport>('POST', `/compat/${encodeURIComponent(id)}/check`),

  workspaces: () => call<{ workspaces: Workspace[] }>('GET', '/workspaces'),
  workspace: (slug: string) => call<{ workspace: Workspace }>('GET', `/workspaces/${enc(slug)}`),
  createWorkspace: (w: { slug: string; name: string; instanceId: string; profile?: string | null }) =>
    call<{ workspace: Workspace }>('POST', '/workspaces', w),
  updateWorkspace: (slug: string, patch: { name?: string }) => call<{ workspace: Workspace }>('PATCH', `/workspaces/${enc(slug)}`, patch),
  agentsMd: (slug: string) => call<{ text: string }>('GET', `/workspaces/${enc(slug)}/agents-md`),
  saveAgentsMd: (slug: string, text: string) => call<{ ok: true }>('PUT', `/workspaces/${enc(slug)}/agents-md`, { text }),
  sessions: (slug: string, archived = false) => call<{ sessions: Session[] }>('GET', `/workspaces/${enc(slug)}/sessions${archived ? '?archived=1' : ''}`),
  createSession: (slug: string) => call<{ session: Session }>('POST', `/workspaces/${enc(slug)}/sessions`),
  session: (inst: string, id: string) => call<{ session: Session; workspace: Workspace; profile: string }>('GET', sessionPath(inst, id)),
  updateSession: (inst: string, id: string, patch: {
    title?: string | null; archived?: boolean; pinned?: boolean; model?: string | null; provider?: string | null; effort?: Effort | null;
    personality?: string | null; autoApprove?: boolean; profile?: string | null;
  }) =>
    call<{ session: Session }>('PATCH', sessionPath(inst, id), patch),
  /** Hidden at once, deleted at Hermes after `undoUntil` unless restored. */
  deleteSession: (inst: string, id: string) => call<{ ok: true; undoUntil: number }>('DELETE', sessionPath(inst, id)),
  bulkSessions: (inst: string, ids: string[], action: BulkAction, workspace?: string) =>
    call<{ results: BulkResult[]; undoUntil?: number }>('POST', `/i/${enc(inst)}/sessions/bulk`, { ids, action, ...(workspace ? { workspace } : {}) }),
  restoreSessions: (inst: string, ids: string[]) => call<{ restored: string[] }>('POST', `/i/${enc(inst)}/sessions/restore`, { ids }),
  /** `key`: made once per action (a retry gives the same copy). */
  rewriteSession: (inst: string, id: string, body: { key: string; before: number | null; mode: 'replace' | 'branch' }) =>
    call<RewriteResult>('POST', `${sessionPath(inst, id)}/rewrite`, body),
  revertRewrite: (inst: string, id: string) => call<{ session: Session }>('POST', `${sessionPath(inst, id)}/revert`),
  /** Title by the auxiliary model of Hermes (409 unsupported / busy, 503 no_model). */
  prompts: (kind: PromptKind = 'prompt') => call<{ prompts: Prompt[] }>('GET', `/prompts?kind=${kind}`),
  createPrompt: (input: { title: string; body: string; kind?: PromptKind }) => call<{ prompt: Prompt }>('POST', '/prompts', input),
  updatePrompt: (id: string, patch: { title?: string; body?: string }) => call<{ prompt: Prompt }>('PATCH', `/prompts/${enc(id)}`, patch),
  deletePrompt: (id: string) => call<{ ok: true }>('DELETE', `/prompts/${enc(id)}`),
  extractArchive: (slug: string, path: string) => call<ExtractResult>('POST', `/workspaces/${enc(slug)}/files/extract`, { path }),
  generateTitle: (inst: string, id: string) => call<{ session: Session }>('POST', `${sessionPath(inst, id)}/title/generate`),
  duplicateSession: (inst: string, id: string, key: string) => call<{ session: Session }>('POST', `${sessionPath(inst, id)}/duplicate`, { key }),
  exportUrl: (inst: string, id: string, format: 'md' | 'html' | 'json') => `/x${sessionPath(inst, id)}/export?format=${format}`,
  importSession: (slug: string, file: unknown, key: string) => call<{ session: Session }>('POST', `/workspaces/${enc(slug)}/sessions/import`, { key, file }),
  continueExternal: (inst: string, id: string, profile: string, workspace: string, key: string) =>
    call<{ session: Session }>('POST', `/i/${enc(inst)}/external/${enc(id)}/continue`, { profile, workspace, key }),
  cleanupInfo: (inst: string) => call<{ unused: number }>('GET', `/i/${enc(inst)}/sessions/cleanup`),
  cleanup: (inst: string) => call<{ ids: string[]; undoUntil: number }>('POST', `/i/${enc(inst)}/sessions/cleanup`),
  messages: (inst: string, id: string) => call<{ messages: ChatMessage[]; runs: RunStat[] }>('GET', `${sessionPath(inst, id)}/messages`),
  send: (inst: string, id: string, input: string, skills?: string[]) =>
    call<{ runId: string; session: Session; notice?: string }>('POST', `${sessionPath(inst, id)}/runs`, { input, ...(skills?.length ? { skills } : {}) }),
  personalities: (inst: string, profile: string) => call<{ items: PersonalityItem[]; error?: string }>('GET', instPath(inst, `personalities?profile=${enc(profile)}`)),
  modelPins: (inst: string, profile: string) => call<{ pins: ModelPin[] }>('GET', instPath(inst, `model-pins?profile=${enc(profile)}`)),
  setModelPins: (inst: string, profile: string, pins: ModelPin[]) => call<{ pins: ModelPin[] }>('PUT', instPath(inst, `model-pins?profile=${enc(profile)}`), { pins }),
  modes: (inst: string, profile: string) => call<{ modes: RunMode[] }>('GET', instPath(inst, `modes?profile=${enc(profile)}`)),
  setModes: (inst: string, profile: string, modes: RunMode[]) => call<{ modes: RunMode[] }>('PUT', instPath(inst, `modes?profile=${enc(profile)}`), { modes }),
  toProfile: (inst: string, id: string, profile: string, key: string) => call<{ session: Session }>('POST', `${sessionPath(inst, id)}/to-profile`, { profile, key }),
  sessionUsage: (inst: string, id: string) => call<SessionUsage>('GET', `${sessionPath(inst, id)}/usage`),
  runStatus: (inst: string, id: string, runId: string) => call<RunStatus>('GET', `${sessionPath(inst, id)}/runs/${enc(runId)}`),
  stop: (inst: string, id: string, runId: string) => call<unknown>('POST', `${sessionPath(inst, id)}/runs/${enc(runId)}/stop`, {}),
  approve: (inst: string, id: string, runId: string, choice: ApprovalChoice, requestId?: string) =>
    call<unknown>('POST', `${sessionPath(inst, id)}/runs/${enc(runId)}/approval`, { choice, requestId }),
  /** Text given to the agent during its run, after its current tools (409 steer_refused when it does not take it). */
  steer: (inst: string, id: string, runId: string, input: string) =>
    call<unknown>('POST', `${sessionPath(inst, id)}/runs/${enc(runId)}/steer`, { input }),
  /** Answer to a question of the agent (several choices: a JSON array of their labels). */
  clarify: (inst: string, id: string, runId: string, answer: string, requestId?: string) =>
    call<unknown>('POST', `${sessionPath(inst, id)}/runs/${enc(runId)}/clarify`, { answer, requestId }),
  chatModels: (inst: string, profile = 'default') => call<ChatModelList>('GET', `/i/${enc(inst)}/chat-models?profile=${enc(profile)}`),
  /** same list for an agent's default model: any agent, with or without a chat key */
  agentModels: (inst: string, profile: string) => call<ChatModelList>('GET', `/i/${enc(inst)}/chat-models?profile=${enc(profile)}&for=agent`),
  otherSessions: (inst: string, profile = 'default', offset = 0) =>
    call<{ sessions: OtherSession[]; hasMore: boolean; nextOffset: number }>('GET', `/i/${enc(inst)}/other-sessions?profile=${enc(profile)}&offset=${offset}`),
  externalMessages: (inst: string, id: string, profile = 'default') =>
    call<{ messages: ChatMessage[] }>('GET', `/i/${enc(inst)}/external/${enc(id)}/messages?profile=${enc(profile)}`),

  tree: (slug: string, path = '') => call<FileTree>('GET', `${filesPath(slug)}/tree?path=${enc(path)}`),
  gitLocate: (slug: string, path: string) => call<{ repo: string | null; outside: boolean }>('GET', `${gitPath(slug)}/locate?path=${enc(path)}`),
  gitStatus: (slug: string, repo: string) => call<GitStatus>('GET', `${gitPath(slug)}?repo=${enc(repo)}`),
  gitStage: (slug: string, repo: string, file?: string) => call<{ unstaged: string[] }>('POST', `${gitPath(slug)}/stage`, { repo, file }),
  gitUnstage: (slug: string, repo: string, file?: string) => call<{ ok: true }>('POST', `${gitPath(slug)}/unstage`, { repo, file }),
  gitRevert: (slug: string, repo: string, file: string) => call<{ ok: true }>('POST', `${gitPath(slug)}/revert`, { repo, file }),
  gitCommit: (slug: string, repo: string, message: string, push: boolean) =>
    call<{ committed: true; pushError?: string }>('POST', `${gitPath(slug)}/commit`, { repo, message, push }),
  gitPush: (slug: string, repo: string) => call<{ ok: true }>('POST', `${gitPath(slug)}/push`, { repo }),
  gitSwitch: (slug: string, repo: string, branch: string) => call<{ branch: string }>('POST', `${gitPath(slug)}/switch`, { repo, branch }),
  gitMessage: (slug: string, repo: string, avoid?: string) => call<{ message: string }>('POST', `${gitPath(slug)}/message`, { repo, avoid }),
  gitBranches: (slug: string, repo: string) => call<{ branches: { name: string; current: boolean }[] }>('GET', `${gitPath(slug)}/branches?repo=${enc(repo)}`),
  instanceTree: (inst: string, path = '') =>
    call<FileTree>('GET', `/i/${enc(inst)}/files/tree?path=${enc(path)}`),
  instanceSearchFiles: (inst: string, q: string) =>
    call<{ results: FileEntry[]; truncated: boolean }>('GET', `/i/${enc(inst)}/files/search?q=${enc(q)}`),
  searchFiles: (slug: string, q: string) => call<{ results: FileEntry[]; truncated: boolean }>('GET', `${filesPath(slug)}/search?q=${enc(q)}`),
  moveFile: (slug: string, from: string, to: string) => call<{ path: string; leftover?: string[] }>('PATCH', `${filesPath(slug)}/move`, { from, to }),
  createEntry: (slug: string, path: string, kind: 'file' | 'dir') => call<{ path: string }>('POST', `${filesPath(slug)}/new`, { path, kind }),
  deleteFile: (slug: string, path: string) => call<{ ok: true }>('DELETE', `${filesPath(slug)}?path=${enc(path)}`),
  saveText: (slug: string, path: string, text: string, mtime: number) => call<{ mtime: number }>('PUT', `${filesPath(slug)}/text`, { path, text, mtime }),
  filesExist: (slug: string, paths: string[]) =>
    call<{ results: Record<string, { path: string; kind: 'file' | 'dir' } | null> }>('POST', `${filesPath(slug)}/exists`, { paths }),
  shareFile: (slug: string, path: string) => call<{ token: string; url: string; publicUntil: number | null }>('POST', `${filesPath(slug)}/share`, { path }),
  links: () => call<{ links: ShareLink[] }>('GET', '/links'),
  setLinkPublic: (token: string, publicUntil: number | null) => call<{ link: ShareLink }>('PATCH', `/links/${enc(token)}`, { publicUntil }),
  revokeLink: (token: string) => call<{ ok: true }>('DELETE', `/links/${enc(token)}`),
  mcp: (inst: string) => call<McpInfo>('GET', `/instances/${enc(inst)}/mcp`),
  rotateMcp: (inst: string) => call<McpInfo & { test?: McpTest; error?: string }>('POST', `/instances/${enc(inst)}/mcp/rotate`, {}),
  connectMcp: (inst: string, replaceOther = false) =>
    call<{ state: McpState; test?: McpTest }>('POST', `/instances/${enc(inst)}/mcp/connect`, { replaceOther }),

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
  recentSessions: (inst: string, limit = 20, source: SessionSource = 'all') =>
    call<{ sessions: RecentSession[] } & SessionErrors>('GET', instPath(inst, `sessions/recent?limit=${limit}${source === 'all' ? '' : `&source=${source}`}`)),
  /** Intendia titles + message content (dashboard); `partial` = instances where only titles were searched. */
  searchSessions: (inst: string, q: string, source: SessionSource = 'all') =>
    call<{ sessions: RecentSession[]; partial: string[] } & SessionErrors>('GET', instPath(inst, `sessions/search?q=${encodeURIComponent(q)}${source === 'all' ? '' : `&source=${source}`}`)),
  cronsOverview: () => call<{ crons: OverviewCron[]; errors: { instance: string; message: string }[] }>('GET', '/crons/overview'),
  profiles: (inst: string) => call<{ profiles: string[] }>('GET', instPath(inst, 'agents/profiles')),
  agents: (inst: string) => call<{ agents: Agent[] }>('GET', instPath(inst, 'agents')),
  agent: (inst: string, name: string) => call<{ agent: AgentDetail }>('GET', instPath(inst, `agents/${enc(name)}/detail`)),
  createAgent: (inst: string, a: CreateAgentInput) =>
    call<{ name: string; keySource: 'env' | 'db'; modelError: string | null }>('POST', instPath(inst, 'agents'), a),
  /** 409 `protected` (default) or `in_use` (+ workspaces, sessions); `keyLeft`: its key stays in INTENDIA_INSTANCES */
  deleteAgent: (inst: string, name: string) => call<{ ok: true; keyLeft: boolean; pending: boolean }>('DELETE', instPath(inst, `agents/${enc(name)}`)),
  /** draft of the masked SOUL.md: placeholders get their value back on the server (400 secret_moved / secret_placeholder) */
  setAgentSoul: (inst: string, name: string, content: string) => call<{ soul: string }>('PUT', instPath(inst, `agents/${enc(name)}/soul`), { content }),
  setAgentModel: (inst: string, name: string, provider: string, model: string) =>
    call<{ provider: string; model: string }>('PUT', instPath(inst, `agents/${enc(name)}/model`), { provider, model }),
  describeAgent: (inst: string, name: string) => call<{ description: string | null; reason: string | null }>('POST', instPath(inst, `agents/${enc(name)}/describe`), {}),
  /** 409 `refused` (stop: live sessions, ask then interrupt) or `multiplexed` */
  gatewayAction: (inst: string, profile: string, action: GatewayAction, interrupt = false) =>
    call<{ ok: true }>('POST', instPath(inst, `config/gateway/${action}`, profile), action === 'stop' ? { interrupt } : {}),
  gatewayActionStatus: (inst: string, profile: string, action: GatewayAction) => call<RestartStatus>('GET', instPath(inst, `config/gateway/${action}`, profile)),
  setAgentDescription: (inst: string, name: string, description: string) =>
    call<{ description: string }>('PUT', instPath(inst, `agents/${enc(name)}/description`), { description }),
  activity: (inst: string) => call<Activity>('GET', instPath(inst, 'activity')),
  monitorUsage: (inst: string, profile: string, days: number) => call<PublicUsage>('GET', instPath(inst, 'monitor/usage', profile, { days: String(days) })),
  monitorLogs: (inst: string, profile: string, q: LogQuery) => call<PublicLogs>('GET', instPath(inst, 'monitor/logs', profile, Object.fromEntries(
    Object.entries({ file: q.file, lines: String(q.lines), level: q.level, component: q.component, search: q.search }).filter((e): e is [string, string] => Boolean(e[1])),
  ))),
  monitorSystem: (inst: string) => call<PublicSystemStats>('GET', instPath(inst, 'monitor/system')),
  /** Runs of every instance waiting for approval, with their question. */
  approvals: () => call<{ approvals: PendingApproval[] }>('GET', '/approvals'),
  kanbanBoards: (inst: string) => call<{ boards: KanbanBoard[] }>('GET', kanbanPath(inst, 'boards')),
  createKanbanBoard: (inst: string, slug: string, name?: string) => call<{ board: KanbanBoard }>('POST', kanbanPath(inst, 'boards'), { slug, name }),
  kanbanBoard: (inst: string, board: string) => call<KanbanBoardView>('GET', kanbanPath(inst, 'board', board)),
  kanbanWorkflow: (inst: string) => call<KanbanWorkflow>('GET', kanbanPath(inst, 'workflow')),
  kanbanAssignees: (inst: string) => call<{ assignees: string[] }>('GET', kanbanPath(inst, 'assignees')),
  kanbanOrchestration: (inst: string) => call<KanbanOrchestration>('GET', kanbanPath(inst, 'orchestration')),
  setKanbanOrchestration: (inst: string, o: { orchestrator_profile?: string; default_assignee?: string; auto_decompose?: boolean; auto_promote_children?: boolean }) =>
    call<{ version: string | null; profile: string }>('PUT', kanbanPath(inst, 'orchestration'), o),
  createKanbanTask: (inst: string, board: string, t: KanbanTaskInput) => call<{ task: KanbanTask }>('POST', kanbanPath(inst, 'tasks', board), t),
  kanbanTask: (inst: string, board: string, id: string) => call<KanbanTaskDetail>('GET', kanbanPath(inst, `tasks/${enc(id)}`, board)),
  updateKanbanTask: (inst: string, board: string, id: string, patch: KanbanTaskPatch) =>
    call<{ task: KanbanTask }>('PATCH', kanbanPath(inst, `tasks/${enc(id)}`, board), patch),
  kanbanLog: (inst: string, board: string, id: string) => call<{ content: string; exists: boolean; truncated: boolean }>('GET', kanbanPath(inst, `tasks/${enc(id)}/log`, board)),
  commentKanbanTask: (inst: string, board: string, id: string, body: string) => call<{ ok: true }>('POST', kanbanPath(inst, `tasks/${enc(id)}/comments`, board), { body }),
  kanbanAux: (inst: string, board: string, id: string, op: 'specify' | 'decompose') => call<Record<string, unknown>>('POST', kanbanPath(inst, `tasks/${enc(id)}/${op}`, board), {}),
  linkKanbanTasks: (inst: string, board: string, parent: string, child: string) => call<{ ok: true }>('POST', kanbanPath(inst, 'links', board), { parent, child }),
  unlinkKanbanTasks: (inst: string, board: string, parent: string, child: string) => call<{ ok: true }>('DELETE', kanbanPath(inst, 'links', board, { parent, child })),
  dispatchKanban: (inst: string, board: string, dryRun: boolean) =>
    call<{ spawned: { taskId: string; assignee: string | null }[]; skippedUnassigned: string[]; dryRun: boolean }>('POST', kanbanPath(inst, 'dispatch', board, dryRun ? { dry_run: '1' } : {}), {}),
  stopWorker: (inst: string, board: string, runId: number) =>
    call<{ taskId: string; status: string }>('POST', kanbanPath(inst, `workers/${runId}/stop`, board), {}),
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
  config: (inst: string, profile: string) => call<ConfigForm>('GET', instPath(inst, 'config', profile)),
  saveConfig: (inst: string, profile: string, changes: Record<string, unknown>, version: string) =>
    call<WriteResult>('PUT', instPath(inst, 'config', profile), { changes, version }),
  configRaw: (inst: string, profile: string) => call<{ yaml: string; version: string }>('GET', instPath(inst, 'config/raw', profile)),
  saveConfigRaw: (inst: string, profile: string, yaml: string, version: string) =>
    call<WriteResult>('PUT', instPath(inst, 'config/raw', profile), { yaml, version }),
  configVersions: (inst: string, profile: string) => call<{ versions: ConfigVersion[] }>('GET', instPath(inst, 'config/versions', profile)),
  configVersion: (inst: string, profile: string, id: number) => call<{ yaml: string }>('GET', instPath(inst, `config/versions/${id}`, profile)),
  restoreConfig: (inst: string, profile: string, id: number, version: string) =>
    call<WriteResult>('POST', instPath(inst, `config/versions/${id}/restore`, profile), { version }),
  configModels: (inst: string, profile: string) => call<ConfigModels>('GET', instPath(inst, 'config/models', profile)),
  changeProviderModels: (inst: string, profile: string, body: { provider: string; add?: string; remove?: string }) =>
    call<{ declared: string[] }>('POST', instPath(inst, 'config/provider-models', profile), body),
  /** Several auxiliary tasks in one write, all or nothing. */
  setAuxiliary: (inst: string, profile: string, body: { version: string; changes: { task: string; provider: string; model: string }[]; confirm?: boolean }) =>
    call<WriteResult & { notice?: string }>('POST', instPath(inst, 'config/auxiliary', profile), body),
  setModel: (inst: string, profile: string, m: ModelInput) => call<WriteResult & { notice?: string }>('POST', instPath(inst, 'config/models', profile), m),
  customProviders: (inst: string, profile: string) =>
    call<{ endpoints: CustomProvider[]; writable: boolean }>('GET', instPath(inst, 'config/custom-providers', profile)),
  addCustomProvider: (inst: string, profile: string, body: { name: string; baseUrl: string; apiKey?: string; model?: string }) =>
    call<WriteResult & { slug: string }>('POST', instPath(inst, 'config/custom-providers', profile), body),
  removeCustomProvider: (inst: string, profile: string, slug: string) =>
    call<WriteResult & { keyLeft?: string }>('DELETE', instPath(inst, `config/custom-providers/${enc(slug)}`, profile)),
  configProviders: (inst: string, profile: string) => call<ProvidersInfo>('GET', instPath(inst, 'config/providers', profile)),
  connectProvider: (inst: string, profile: string, provider: string) =>
    call<ConnectStart>('POST', instPath(inst, `config/providers/${enc(provider)}/connect`, profile), {}),
  pollConnect: (inst: string, profile: string, provider: string, session: string) =>
    call<ConnectPoll>('GET', instPath(inst, `config/providers/${enc(provider)}/connect/${enc(session)}`, profile)),
  cancelConnect: (inst: string, profile: string, session: string) =>
    call<{ ok: true }>('DELETE', instPath(inst, `config/connect/${enc(session)}`, profile)),
  disconnectProvider: (inst: string, profile: string, provider: string) =>
    call<{ ok: true }>('DELETE', instPath(inst, `config/providers/${enc(provider)}/account`, profile)),
  addProviderKey: (inst: string, profile: string, k: { provider: string; apiKey: string; label?: string }) =>
    call<{ count: number | null }>('POST', instPath(inst, 'config/provider-keys', profile), k),
  setAnthropicToken: (inst: string, profile: string, token: string, replaceApiKey = false) =>
    call<{ version: string | null; restartNeeded: boolean }>('POST', instPath(inst, 'config/providers/anthropic/token', profile), { token, replaceApiKey }),
  removeAnthropicToken: (inst: string, profile: string) =>
    call<{ version: string | null; left: string[]; restartNeeded: boolean }>('DELETE', instPath(inst, 'config/providers/anthropic/token', profile)),
  removeProviderKey: (inst: string, profile: string, provider: string, id: string) =>
    call<{ ok: true }>('DELETE', instPath(inst, `config/provider-keys/${enc(provider)}/${enc(id)}`, profile)),
  configEnv: (inst: string, profile: string) => call<{ env: EnvVar[] }>('GET', instPath(inst, 'config/env', profile)),
  setEnv: (inst: string, profile: string, key: string, value: string) => call<WriteResult>('PUT', instPath(inst, 'config/env', profile), { key, value }),
  deleteEnv: (inst: string, profile: string, key: string) => call<WriteResult>('DELETE', instPath(inst, `config/env/${enc(key)}`, profile)),
  mcpServers: (inst: string, profile: string) => call<{ servers: McpServer[] }>('GET', instPath(inst, 'config/mcp', profile)),
  addMcp: (inst: string, profile: string, m: McpInput) => call<WriteResult>('POST', instPath(inst, 'config/mcp', profile), m),
  testMcp: (inst: string, profile: string, name: string) =>
    call<{ ok: boolean; tools: string[]; error?: string }>('POST', instPath(inst, `config/mcp/${enc(name)}/test`, profile), {}),
  enableMcp: (inst: string, profile: string, name: string, enabled: boolean) =>
    call<WriteResult>('PUT', instPath(inst, `config/mcp/${enc(name)}/enabled`, profile), { enabled }),
  removeMcp: (inst: string, profile: string, name: string) =>
    call<WriteResult & { tokenLeft?: string }>('DELETE', instPath(inst, `config/mcp/${enc(name)}`, profile)),
  platforms: (inst: string, profile: string) => call<{ platforms: Platform[] }>('GET', instPath(inst, 'config/platforms', profile)),
  restartGateway: (inst: string, profile: string) => call<{ ok: true }>('POST', instPath(inst, 'config/gateway/restart', profile), {}),
  restartStatus: (inst: string, profile: string) => call<RestartStatus>('GET', instPath(inst, 'config/gateway/restart', profile)),
};

/** URL of a file's content (preview, download); served with CSP sandbox (scripts allowed for an artefact). */
export const rawUrl = (slug: string, path: string, download = false, artifact = false) =>
  `/x${filesPath(slug)}/raw?path=${enc(path)}${download ? '&download=1' : ''}${artifact ? '&artefact=1' : ''}`;

/** Diff of one file of a repository, as text (read by DiffView). */
export const gitDiffUrl = (slug: string, repo: string, file: string, which: GitDiffWhich) =>
  `/x${gitPath(slug)}/diff?repo=${enc(repo)}&file=${enc(file)}&which=${which}`;

/** A folder as a zip (built while sent; `<folder>.zip`, `<slug>.zip` for the root). */
export const zipUrl = (slug: string, path: string) => `/x${filesPath(slug)}/zip?path=${enc(path)}`;
export const instanceZipUrl = (inst: string, path: string) => `/x/i/${enc(inst)}/files/zip?path=${enc(path)}`;

/** URL of a file of an instance's file root (read only page « Fichiers »). */
export const instanceRawUrl = (inst: string, path: string, download = false) =>
  `/x/i/${enc(inst)}/files/raw?path=${enc(path)}${download ? '&download=1' : ''}`;

/** URL of a run's SSE stream (EventSource). */
export const runEventsUrl = (inst: string, id: string, runId: string) => `/x${sessionPath(inst, id)}/runs/${enc(runId)}/events`;
