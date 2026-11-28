export interface KanbanBoard { slug: string; name: string; total: number }
export interface KanbanTask {
  /** Freshness of the title and text: sent back as `base` to change them. */
  revision: string;
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
export interface KanbanTaskPatch { status?: string; assignee?: string | null; priority?: number | null; title?: string; body?: string; blockReason?: string; base?: string }
export type KanbanMissionState = 'decomposing' | 'held' | 'launched' | 'failed' | 'cancelled';
export interface KanbanMissionChild {
  id: string; title: string; body: string; status: string; assignee: string | null;
  /** freshness of the title and text, sent back as `base` */
  revision: string;
  /** other children it waits for */
  after: string[];
  held: boolean;
  lostTracking: boolean;
}
export interface KanbanMissionRow {
  id: string; instanceId: string; board: string; rootId: string | null; goal: string; state: KanbanMissionState;
  error: string | null; createdAt: number; updatedAt: number;
}
export interface KanbanMission extends KanbanMissionRow { rootStatus: string | null; children: KanbanMissionChild[] }
