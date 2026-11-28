import type { Effort } from './chat';

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
  /** « Sans confirmation »: Intendia approves the actions of its runs */
  autoApprove?: boolean;
  /** profile chosen for this session (null = the workspace's) */
  profile?: string | null;
}
/** A truncated copy: `before` = Hermes row id of the user message to cut before, 0 = nothing kept, null = all. */
export interface RewriteResult { session: Session; replaced?: string; undoUntil?: number | null }
export type BulkAction = 'archive' | 'unarchive' | 'pin' | 'unpin' | 'delete' | 'move';
export interface BulkResult { id: string; ok: boolean; error?: string }
/** Delivery of background sub-agents, read by the server from Hermes' text (chat/delegation.ts). */
export interface DelegationInfo {
  id: string | null;
  tasks: number | null;
  completed: number | null;
  failed: number | null;
  durationSeconds: number | null;
  /** base 0: early failure notice of one task */
  failedTask: number | null;
  /** base 0; index null = the single task of a single-child delivery */
  taskStatuses: { index: number | null; status: string }[];
  allFailed: boolean;
}
/** Session of a sub-agent at Hermes (live tracking of a background one). Times in seconds. */
export interface SubagentChild {
  id: string;
  /** first 60 characters of its goal (Hermes' preview) */
  goal: string;
  /** the goal was cut by Hermes */
  cut: boolean;
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  lastActive: number | null;
  toolCalls: number | null;
  apiCalls: number | null;
}
export interface ChatMessage {
  id: number;
  /** user, assistant, tool, or delegation (result of background sub-agents, never a message of the user) */
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: { name: string; arguments: string }[];
  /** seconds */
  timestamp: number | null;
  /** given to the agent during a run (reorientation) */
  steer?: true;
  /** role delegation */
  delegation?: DelegationInfo;
  /** role tool: ticket of a delegate_task in the background, read by the server */
  ticket?: TicketInfo;
}
/** Background sub-agents of a session, as the server decides (server: chat/wake.ts); null = nothing open or expected. */
export interface SubagentsSummary {
  openTasks: number;
  /** seconds: newest ticket still open */
  since: number | null;
  /** 5 automatic wakes in a row: none until the user writes */
  capped: boolean;
  /** the last sub-agent delivered: the server is about to wake the agent */
  wakePending: boolean;
  /** a unit given up less than 24 h ago (no delivery): the page keeps re-reading in case it comes */
  lostRecent?: boolean;
  /** seconds: the agent goes on without them at the latest then (INTENDIA_SUBAGENT_MAX_WAIT_MIN); null = no cap */
  waitUntil?: number | null;
}
/** A session whose background sub-agents still work (GET /activity). */
export interface WorkingSubagents {
  instance: string; sessionId: string; workspace: string; workspaceName: string; title: string | null; profile: string;
  tasks: number;
  /** seconds */
  since: number | null;
}
/** Ticket of a delegate_task in the background (server: chat/delegation.ts). Indexes base 0. */
export interface TicketInfo {
  delegationId: string | null;
  goals: string[];
  refused: number[];
  /** units (independent completions), each with its task indexes; empty = the call is the unit */
  units: { id: string; tasks: number[] }[];
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
  /** pinned in Intendia (its own sessions only) */
  pinned?: boolean;
}
export type SessionSource = 'all' | 'intendia' | 'cli' | 'telegram' | 'discord' | 'cron' | 'kanban';
export const SESSION_SOURCES: SessionSource[] = ['all', 'intendia', 'cli', 'telegram', 'discord', 'cron', 'kanban'];
export interface SessionErrors { errors: { instance: string; message: string }[] }
/** Persistent goal of a session (option 7): relaunched by Intendia's server after each run (chat/goal.ts). */
export type GoalReason = 'user' | 'button' | 'click' | 'blocked' | 'failed' | 'stopped' | 'lost' | 'limit' | 'budget' | 'start_failed' | 'gone' | 'cost_unknown' | 'key_conflict';
export interface SessionGoal {
  text: string;
  status: 'active' | 'paused' | 'done';
  mode: 'auto' | 'click';
  maxRelaunches: number;
  relaunches: number;
  budgetUsd: number | null;
  reason: GoalReason | null;
  reasonDetail: string | null;
  spent: { usd: number; pending: boolean; priceUnknown: boolean; unpriced: number };
  /** the session's last run: a relaunch started by the server makes it change */
  lastRunId: string | null;
  updatedAt: number;
}
export interface GoalSettings { text: string; maxRelaunches: number; budgetUsd: number | null; mode: 'auto' | 'click' }
