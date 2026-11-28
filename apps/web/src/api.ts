// Typed client for the Intendia server (/x/*). Mirrors apps/server/src/connectors/types.ts.
import { call } from './api/call';
import { cronPath, cronsPath, enc, filesPath, gitPath, instPath, kanbanPath, profileParam, sessionPath } from './api/paths';
import type { Activity, Agent, AgentDetail, CreateAgentInput, FinishedRun, PendingApproval } from './api/types/agents';
import type { ChannelDetail, ChannelItem } from './api/types/channels';
import type { ApprovalChoice, ChatModelList, Effort, ExtractResult, ModelPin, Prompt, PromptKind, RunMode, RunStat } from './api/types/chat';
import type { ConfigForm, ConfigVersion, EnvVar, GatewayAction, Platform, RestartStatus, WriteResult } from './api/types/config';
import type { Blueprint, Cron, CronInput, CronRun, DeliveryTarget, OverviewCron } from './api/types/crons';
import type { FileEntry, FileTree, GitStatus, ShareLink } from './api/types/files';
import type { CompatReport, InstanceInput, InstancePatch, PublicInstance, SessionUsage, SetupState, Workspace } from './api/types/instances';
import type { KanbanBoard, KanbanBoardView, KanbanMission, KanbanMissionRow, KanbanOrchestration, KanbanTask, KanbanTaskDetail, KanbanTaskInput, KanbanTaskPatch, KanbanWorkflow } from './api/types/kanban';
import type { McpCatalog, McpFlow, McpInfo, McpInput, McpOauthMode, McpServer, McpState, McpTest, Plugin, PluginCatalog, PluginJob } from './api/types/mcp';
import type { ConfigModels, ConnectPoll, ConnectStart, CustomProvider, ModelInput, ProvidersInfo } from './api/types/providers';
import type { BulkAction, BulkResult, ChatMessage, GoalSettings, OtherSession, RecentSession, RewriteResult, RunStatus, Session, SessionErrors, SessionGoal, SessionSource, SubagentChild, SubagentsSummary } from './api/types/sessions';
import type { ActionStatus, HubResult, MemoryOverview, Scan, Skill, Toolset } from './api/types/skills';
import type { LogQuery, PublicLogs, PublicSystemStats, PublicUsage } from './api/types/usage';
import type { VaultInput, VaultItem } from './api/types/vault';

export * from './api/types/instances';
export * from './api/types/chat';
export * from './api/types/sessions';
export * from './api/types/files';
export * from './api/types/crons';
export * from './api/types/skills';
export * from './api/types/mcp';
export * from './api/types/config';
export * from './api/types/providers';
export * from './api/types/agents';
export * from './api/types/kanban';
export * from './api/types/vault';
export * from './api/types/usage';
export * from './api/types/channels';
export { ApiError, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, isTransient, setCallHooks } from './api/call';
export { gitDiffUrl, instanceRawUrl, instanceZipUrl, kanbanPath, rawUrl, runEventsUrl, sessionPath, zipUrl } from './api/paths';

export const api = {
  setup: () => call<SetupState>('GET', '/setup'),
  setPassword: (code: string, password: string) => call<{ ok: true }>('POST', '/setup/password', { code, password }),
  login: (password: string) => call<{ ok: true }>('POST', '/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/logout', {}),
  /** Deletes every sign-in session; this browser gets a new cookie and stays signed in. */
  revokeAllSessions: () => call<{ ok: true }>('POST', '/auth/revoke-all', {}),
  instances: () => call<{ declarative: boolean; instances: PublicInstance[] }>('GET', '/instances'),
  testInstance: (i: InstanceInput) => call<CompatReport>('POST', '/instances/test', i),
  saveInstance: (i: InstanceInput) => call<{ instance: PublicInstance; report: CompatReport }>('POST', '/instances', i),
  removeInstance: (id: string) => call<{ ok: true }>('DELETE', `/instances/${encodeURIComponent(id)}`),
  renameInstance: (id: string, label: string) => call<{ instance: PublicInstance }>('PATCH', `/instances/${encodeURIComponent(id)}`, { label }),
  /** Tests the saved instance with these changes, without saving (the server adds the secrets it keeps). */
  testInstanceEdit: (id: string, patch: InstancePatch) => call<CompatReport>('POST', `/instances/${encodeURIComponent(id)}/test`, patch),
  updateInstance: (id: string, patch: InstancePatch) =>
    call<{ instance: PublicInstance; report: CompatReport | null; mcp?: { state: McpState } }>('PATCH', `/instances/${encodeURIComponent(id)}`, patch),
  compat: () => call<{ reports: CompatReport[] }>('GET', '/compat'),
  recheck: (id: string) => call<CompatReport>('POST', `/compat/${encodeURIComponent(id)}/check`),

  workspaces: () => call<{ workspaces: Workspace[] }>('GET', '/workspaces'),
  workspace: (slug: string) => call<{ workspace: Workspace }>('GET', `/workspaces/${enc(slug)}`),
  createWorkspace: (w: { slug: string; name: string; instanceId: string; profile?: string | null }) =>
    call<{ workspace: Workspace }>('POST', '/workspaces', w),
  updateWorkspace: (slug: string, patch: { name?: string }) => call<{ workspace: Workspace }>('PATCH', `/workspaces/${enc(slug)}`, patch),
  agentsMd: (slug: string) => call<{ text: string; revision: string }>('GET', `/workspaces/${enc(slug)}/agents-md`),
  saveAgentsMd: (slug: string, text: string, base: string) => call<{ ok: true }>('PUT', `/workspaces/${enc(slug)}/agents-md`, { text, base }),
  sessions: (slug: string, archived = false) => call<{ sessions: Session[] }>('GET', `/workspaces/${enc(slug)}/sessions${archived ? '?archived=1' : ''}`),
  createSession: (slug: string) => call<{ session: Session }>('POST', `/workspaces/${enc(slug)}/sessions`),
  session: (inst: string, id: string) => call<{ session: Session; workspace: Workspace; profile: string }>('GET', sessionPath(inst, id)),
  updateSession: (inst: string, id: string, patch: {
    title?: string | null; archived?: boolean; pinned?: boolean; model?: string | null; provider?: string | null; effort?: Effort | null;
    autoApprove?: boolean; profile?: string | null;
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
  /**
   * One page of 500 messages from the end (`offset`: raw rows already read, the `nextOffset` of the previous page;
   * hidden rows count). `hasMore`: an older page may follow.
   * `runs`, `subagents` and `openUnits` only on the latest page (`offset` 0).
   */
  messages: (inst: string, id: string, offset = 0) => call<{ messages: ChatMessage[]; hasMore: boolean; nextOffset?: number; runs?: RunStat[]; subagents?: SubagentsSummary | null; openUnits?: string[] }>(
    'GET', `${sessionPath(inst, id)}/messages${offset > 0 ? `?offset=${offset}` : ''}`),
  /** The session's run rows and their cost, read without any message (cost follow-up after a run). */
  runStats: (inst: string, id: string) => call<{ runs: RunStat[] }>('GET', `${sessionPath(inst, id)}/run-stats`),
  /** « Ne plus attendre »: the units the page showed open are given up (409 run_active while a run goes on) */
  stopWaitingSubagents: (inst: string, id: string, units: string[]) => call<{ lost: number }>('POST', `${sessionPath(inst, id)}/subagents/stop-waiting`, { units }),
  sessionSubagents: (inst: string, id: string) => call<{ children: SubagentChild[] }>('GET', `${sessionPath(inst, id)}/subagents`),
  /** `clientKey`: drawn once per composed message, kept until the send succeeded (one run at Hermes per message). */
  send: (inst: string, id: string, input: string, skills?: string[], clientKey?: string) =>
    call<{ runId: string; session: Session }>('POST', `${sessionPath(inst, id)}/runs`, {
      input, ...(skills?.length ? { skills } : {}), ...(clientKey ? { clientKey } : {}),
    }),
  modelPins: (inst: string, profile: string) => call<{ pins: ModelPin[] }>('GET', instPath(inst, `model-pins?profile=${enc(profile)}`)),
  setModelPins: (inst: string, profile: string, pins: ModelPin[]) => call<{ pins: ModelPin[] }>('PUT', instPath(inst, `model-pins?profile=${enc(profile)}`), { pins }),
  /** colour index of each agent's avatar (agents/look.ts), per instance */
  channels: () => call<{ channels: ChannelItem[] }>('GET', '/channels'),
  channel: (id: string) => call<ChannelDetail>('GET', `/channels/${enc(id)}`),
  createChannel: (body: { name: string; instructions: string; lead: number; members: { instanceId: string; profile: string }[] }) =>
    call<{ channel: { id: string; name: string } }>('POST', '/channels', body),
  updateChannel: (id: string, patch: { name?: string; instructions?: string; lead?: string }) => call<unknown>('PATCH', `/channels/${enc(id)}`, patch),
  archiveChannel: (id: string) => call<{ ok: true }>('DELETE', `/channels/${enc(id)}`),
  postChannel: (id: string, text: string) => call<{ message: { seq: number } }>('POST', `/channels/${enc(id)}/messages`, { text }),
  decideTurn: (id: string, turn: number, body: { action: 'continue' | 'cancel' } | { action: 'reassign'; handle: string }) =>
    call<{ ok: true }>('POST', `/channels/${enc(id)}/turns/${turn}`, body),
  agentLooks: (inst: string) => call<{ looks: Record<string, number> }>('GET', instPath(inst, 'agent-looks')),
  setAgentLooks: (inst: string, looks: Record<string, number>) => call<{ looks: Record<string, number> }>('PUT', instPath(inst, 'agent-looks'), { looks }),
  modes: (inst: string, profile: string) => call<{ modes: RunMode[] }>('GET', instPath(inst, `modes?profile=${enc(profile)}`)),
  setModes: (inst: string, profile: string, modes: RunMode[]) => call<{ modes: RunMode[] }>('PUT', instPath(inst, `modes?profile=${enc(profile)}`), { modes }),
  toProfile: (inst: string, id: string, profile: string, key: string) => call<{ session: Session }>('POST', `${sessionPath(inst, id)}/to-profile`, { profile, key }),
  sessionUsage: (inst: string, id: string) => call<SessionUsage>('GET', `${sessionPath(inst, id)}/usage`),
  goal: (inst: string, id: string) => call<{ goal: SessionGoal | null }>('GET', `${sessionPath(inst, id)}/goal`),
  createGoal: (inst: string, id: string, g: GoalSettings, clientKey?: string) =>
    call<{ runId: string; goal: SessionGoal }>('POST', `${sessionPath(inst, id)}/goal`, { ...g, ...(clientKey ? { clientKey } : {}) }),
  editGoal: (inst: string, id: string, g: Partial<GoalSettings>) => call<{ goal: SessionGoal }>('PATCH', `${sessionPath(inst, id)}/goal`, g),
  pauseGoal: (inst: string, id: string, reason: 'user' | 'button') => call<{ goal: SessionGoal | null }>('POST', `${sessionPath(inst, id)}/goal/pause`, { reason }),
  resumeGoal: (inst: string, id: string) => call<{ goal: SessionGoal }>('POST', `${sessionPath(inst, id)}/goal/resume`, {}),
  clearGoal: (inst: string, id: string) => call<{ goal: null }>('DELETE', `${sessionPath(inst, id)}/goal`),
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
  /** A session born elsewhere, deleted at Hermes now (no undo); 409 `owned` / `child` / `run_active`. */
  deleteExternal: (inst: string, id: string, profile = 'default') =>
    call<{ ok: true }>('DELETE', `/i/${enc(inst)}/external/${enc(id)}?profile=${enc(profile)}`),
  externalMessages: (inst: string, id: string, profile = 'default') =>
    call<{ messages: ChatMessage[]; openUnits?: string[] }>('GET', `/i/${enc(inst)}/external/${enc(id)}/messages?profile=${enc(profile)}`),

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
  rotateMcp: (inst: string) => call<McpInfo & { test?: McpTest; error?: string; restartNeeded?: true; previousUntil?: number | null }>('POST', `/instances/${enc(inst)}/mcp/rotate`, {}),
  revokePreviousMcp: (inst: string) => call<{ ok: true }>('POST', `/instances/${enc(inst)}/mcp/revoke-previous`, {}),
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
  blueprints: (inst: string, profile: string) =>
    call<{ blueprints: Blueprint[] }>('GET', `${cronsPath(inst)}/blueprints?profile=${enc(profile)}`),
  instantiateBlueprint: (inst: string, profile: string, key: string, values: Record<string, string>, workspace: string | null) =>
    call<{ cron: Cron; attached: boolean }>('POST', `${cronsPath(inst)}/blueprints/${enc(key)}?profile=${enc(profile)}`, { values, workspace }),
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
    call<{ name: string; keySource: 'env' | 'db'; modelError: string | null; connectError?: string | null }>('POST', instPath(inst, 'agents'), a),
  /** "Connecter à Intendia": 409 `key_exists` (the profile has its own key: `replace`) or `not_served` (no /p/<name>/) */
  connectAgent: (inst: string, name: string, replace = false) =>
    call<{ hasKey: true; made: boolean; verified: boolean }>('POST', instPath(inst, `agents/${enc(name)}/connect`), replace ? { replace } : {}),
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
  /** Runs in progress and kanban workers of every instance (Centre, « Toutes les instances »). */
  activityAll: () => call<Activity>('GET', '/activity'),
  /** Runs ended in the last 24 h: one instance, or all without `inst`. */
  finishedRuns: (inst?: string) => call<{ runs: FinishedRun[] }>('GET', inst ? `/activity/finished?instance=${enc(inst)}` : '/activity/finished'),
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
  createKanbanMission: (inst: string, board: string, m: { goal: string; body?: string }) =>
    call<{ mission: KanbanMissionRow }>('POST', kanbanPath(inst, 'missions', board), m),
  kanbanMissions: (inst: string, board: string) => call<{ missions: KanbanMissionRow[] }>('GET', kanbanPath(inst, 'missions', board)),
  kanbanMission: (inst: string, id: string) => call<{ mission: KanbanMission }>('GET', kanbanPath(inst, `missions/${enc(id)}`)),
  launchKanbanMission: (inst: string, id: string) => call<{ mission: KanbanMission }>('POST', kanbanPath(inst, `missions/${enc(id)}/launch`)),
  cancelKanbanMission: (inst: string, id: string) => call<{ mission: KanbanMissionRow }>('POST', kanbanPath(inst, `missions/${enc(id)}/cancel`)),
  removeKanbanMissionChild: (inst: string, id: string, child: string) =>
    call<{ mission: KanbanMission }>('DELETE', kanbanPath(inst, `missions/${enc(id)}/children/${enc(child)}`)),
  kanbanAux: (inst: string, board: string, id: string, op: 'specify' | 'decompose') => call<Record<string, unknown>>('POST', kanbanPath(inst, `tasks/${enc(id)}/${op}`, board), {}),
  linkKanbanTasks: (inst: string, board: string, parent: string, child: string) => call<{ ok: true }>('POST', kanbanPath(inst, 'links', board), { parent, child }),
  unlinkKanbanTasks: (inst: string, board: string, parent: string, child: string) => call<{ ok: true }>('DELETE', kanbanPath(inst, 'links', board, { parent, child })),
  dispatchKanban: (inst: string, board: string, dryRun: boolean) =>
    call<{ spawned: { taskId: string; assignee: string | null }[]; skippedUnassigned: string[]; dryRun: boolean }>('POST', kanbanPath(inst, 'dispatch', board, dryRun ? { dry_run: '1' } : {}), {}),
  stopWorker: (inst: string, board: string, runId: number) =>
    call<{ taskId: string; status: string }>('POST', kanbanPath(inst, `workers/${runId}/stop`, board), {}),
  skills: (inst: string, profile: string) => call<{ skills: Skill[] }>('GET', instPath(inst, 'skills', profile)),
  skillContent: (inst: string, profile: string, name: string) =>
    call<{ name: string; content: string; truncated: boolean; revision: string }>('GET', instPath(inst, 'skills/content', profile, { name })),
  setSkillEnabled: (inst: string, profile: string, name: string, enabled: boolean) =>
    call<{ skill: Skill }>('PUT', instPath(inst, 'skills/enabled', profile), { name, enabled }),
  createSkill: (inst: string, profile: string, input: { name: string; category?: string; description: string; body: string }) =>
    call<{ skill: Skill }>('POST', instPath(inst, 'skills', profile), input),
  putSkillContent: (inst: string, profile: string, name: string, content: string, base: string) =>
    call<{ content: string; revision: string }>('PUT', instPath(inst, 'skills/content', profile), { name, content, base }),
  lockSkill: (inst: string, profile: string, name: string, locked: boolean) =>
    call<{ skill: Skill }>('PUT', instPath(inst, 'skills/lock', profile), { name, locked }),
  archiveSkill: (inst: string, profile: string, name: string) => call<{ ok: true }>('DELETE', instPath(inst, `skills/${enc(name)}`, profile)),
  plugins: (inst: string) => call<{ plugins: Plugin[] }>('GET', instPath(inst, 'plugins')),
  pluginCatalog: (inst: string) => call<PluginCatalog>('GET', instPath(inst, 'plugins/catalog')),
  installPlugin: (inst: string, name: string) => call<{ job: PluginJob }>('POST', instPath(inst, 'plugins/install'), { name }),
  pluginJobs: (inst: string) => call<{ job: PluginJob | null }>('GET', instPath(inst, 'plugins/jobs')),
  pluginJob: (inst: string, id: string) => call<PluginJob>('GET', instPath(inst, `plugins/jobs/${enc(id)}`)),
  setPluginEnabled: (inst: string, name: string, enabled: boolean) => call<{ ok: true }>('POST', instPath(inst, `plugins/${enc(name)}/${enabled ? 'enable' : 'disable'}`)),
  removePlugin: (inst: string, name: string) => call<{ ok: true }>('DELETE', instPath(inst, `plugins/${enc(name)}`)),
  memory: (inst: string, profile: string) => call<MemoryOverview>('GET', instPath(inst, 'memory', profile)),
  vault: (inst: string, profile: string) => call<{ items: VaultItem[]; external: number }>('GET', instPath(inst, 'vault', profileParam(profile))),
  vaultAdd: (inst: string, profile: string, input: VaultInput) => call<{ id: string }>('POST', instPath(inst, 'vault', profileParam(profile)), input),
  vaultReplace: (inst: string, profile: string, id: string, input: VaultInput) =>
    call<{ id: string; oldKept: boolean }>('POST', instPath(inst, `vault/${enc(id)}/replace`, profileParam(profile)), input),
  vaultRemove: (inst: string, profile: string, id: string) => call<null>('DELETE', instPath(inst, `vault/${enc(id)}`, profileParam(profile))),
  memoryEntry: (inst: string, profile: string, id: string) => call<{ id: string; content: string }>('GET', instPath(inst, 'memory/entry', profile, { id })),
  putMemoryEntry: (inst: string, profile: string, id: string, content: string) => call<{ ok: true }>('PUT', instPath(inst, 'memory/entry', profile), { id, content }),
  deleteMemoryEntry: (inst: string, profile: string, id: string) => call<{ ok: true }>('DELETE', instPath(inst, 'memory/entry', profile, { id })),
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
  configRaw: (inst: string, profile: string) => call<{ yaml: string; version: string; managed: boolean | null }>('GET', instPath(inst, 'config/raw', profile)),
  saveConfigRaw: (inst: string, profile: string, yaml: string, version: string) =>
    call<WriteResult>('PUT', instPath(inst, 'config/raw', profile), { yaml, version }),
  configVersions: (inst: string, profile: string) => call<{ versions: ConfigVersion[] }>('GET', instPath(inst, 'config/versions', profile)),
  configVersion: (inst: string, profile: string, id: number) => call<{ yaml: string }>('GET', instPath(inst, `config/versions/${id}`, profile)),
  restoreConfig: (inst: string, profile: string, id: number, version: string) =>
    call<WriteResult>('POST', instPath(inst, `config/versions/${id}/restore`, profile), { version }),
  configModels: (inst: string, profile: string) => call<ConfigModels>('GET', instPath(inst, 'config/models', profile)),
  /** main model only (never writes): the home page's « finish the setup » notice */
  modelInfo: (inst: string, profile = 'default') => call<{ model: string | null; provider: string | null }>('GET', instPath(inst, 'config/model-info', profile)),
  /** Hermes' pick for a provider (may write discovered models of custom endpoints, like the model selectors) */
  recommendedModel: (inst: string, provider: string, profile = 'default') =>
    call<{ provider: string; model: string | null }>('GET', instPath(inst, 'config/recommended-model', profile, { provider })),
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
  mcpCatalog: (inst: string, profile: string) => call<McpCatalog>('GET', instPath(inst, 'config/mcp/catalog', profile)),
  installMcpCatalog: (inst: string, profile: string, name: string, env: Record<string, string>) =>
    call<{ version: string | null; background: boolean }>('POST', instPath(inst, `config/mcp/catalog/${enc(name)}`, profile), { env }),
  connectMcpOauth: (inst: string, profile: string, name: string) =>
    call<{ flow: McpFlow; mode: McpOauthMode }>('POST', instPath(inst, `config/mcp/${enc(name)}/connect`, profile)),
  mcpFlow: (inst: string, profile: string, id: string) => call<McpFlow>('GET', instPath(inst, `config/mcp/flows/${enc(id)}`, profile)),
  cancelMcpFlow: (inst: string, profile: string, id: string) => call<{ ok: true }>('DELETE', instPath(inst, `config/mcp/flows/${enc(id)}`, profile)),
  platforms: (inst: string, profile: string) => call<{ platforms: Platform[] }>('GET', instPath(inst, 'config/platforms', profile)),
  restartGateway: (inst: string, profile: string) => call<{ ok: true }>('POST', instPath(inst, 'config/gateway/restart', profile), {}),
  restartStatus: (inst: string, profile: string) => call<RestartStatus>('GET', instPath(inst, 'config/gateway/restart', profile)),
};
