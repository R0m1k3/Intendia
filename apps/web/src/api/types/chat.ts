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
export interface ModelPin { provider: string | null; model: string }
export interface RunMode { id: string; name: string; model: string | null; provider: string | null; effort: Effort | null }
export type PromptKind = 'prompt';
export interface Prompt { id: string; kind: PromptKind; title: string; body: string; createdAt: number; updatedAt: number }
export interface ExtractResult {
  folder: string;
  count: number;
  skipped: { path: string; reason: string }[];
  partial: boolean;
  /** French note for the agent (files left out, extraction cut), null when everything went through; never translated */
  agentNote: string | null;
}
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
