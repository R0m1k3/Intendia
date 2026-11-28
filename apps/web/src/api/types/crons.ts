/** Base path of an Intendia session's routes. */
export interface CronSchedule {
  kind: string;
  minutes: number | null;
  expr: string | null;
  runAt: string | null;
  display: string | null;
}
export interface Cron {
  /** Freshness of the editor fields: sent back as `base` on update (409 `stale` when the cron changed since). */
  revision: string;
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
  /** Number of runs asked (null = forever) and already done. */
  repeat: number | null;
  repeatCompleted: number;
  /** IANA zone, null = Hermes' zone. */
  timezone: string | null;
  /** null = every toolset of the agent. */
  enabledToolsets: string[] | null;
  /** null = Hermes' default. */
  catchUp: boolean | null;
  graceMinutes: number | null;
  /** Crons whose last output is given as context. */
  contextFrom: string[];
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
  /** Update only: `revision` of the cron the editor opened. */
  base?: string;
  name: string;
  prompt: string;
  schedule?: string;
  deliver: string;
  skills: string[];
  model: string | null;
  workspace: string | null;
  paused?: boolean;
  /** Advanced options: on create, empty ones are left out; on update, empty = back to Hermes' default. */
  repeat?: number | 'forever';
  timezone?: string | null;
  enabledToolsets?: string[] | null;
  catchUp?: boolean | null;
  graceMinutes?: number | null;
  contextFrom?: string[] | null;
}
export interface BlueprintField {
  name: string;
  /** time, select, text… (an unknown type is shown as a text input) */
  type: string;
  label: string;
  default: string | null;
  options: { value: string; label: string }[];
  optional: boolean;
  /** false: the options are only suggestions, any value is accepted */
  strict: boolean;
  help: string | null;
}
export interface Blueprint {
  key: string;
  title: string;
  description: string | null;
  category: string | null;
  schedule: string | null;
  fields: BlueprintField[];
  source: string | null;
  plugin: string | null;
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
