import type { WorkingSubagents } from './sessions';

export interface CreateAgentInput {
  name: string; description?: string; cloneFrom?: string;
  /** with cloneFrom: memories and sessions too */
  cloneAll?: boolean; noSkills?: boolean; soul?: string; provider?: string; model?: string;
}
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
  /** sessions whose background sub-agents still work (absent from an older server) */
  subagents?: WorkingSubagents[];
  errors: { instance: string; message: string }[];
}
/** A run launched from Intendia that ended in the last 24 h (Centre, « Terminé »). */
export interface FinishedRun {
  instance: string;
  workspace: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  status: string;
  /** ms */
  startedAt: number;
  /** ms */
  endedAt: number;
  costUsd: number | null;
}
