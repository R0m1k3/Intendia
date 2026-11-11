import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Mirrors migrations/*.sql (the SQL files are the source of truth for the schema).

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  configEnc: text('config_enc').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const workspaces = sqliteTable('workspaces', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  instanceId: text('instance_id').notNull(),
  profile: text('profile'),
  /** Last model / effort chosen in one of its sessions: starting point of its new sessions. */
  model: text('model'),
  modelProvider: text('model_provider'),
  effort: text('effort'),
  createdAt: integer('created_at').notNull(),
});

export const sessionWorkspace = sqliteTable(
  'session_workspace',
  {
    sessionId: text('session_id').notNull(),
    instanceId: text('instance_id').notNull(),
    workspaceSlug: text('workspace_slug').notNull(),
    title: text('title'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    lastRunId: text('last_run_id'),
    lastActiveAt: integer('last_active_at'),
    /** Model and reasoning effort sent with each run (NULL = Hermes default). */
    model: text('model'),
    /** Provider of `model` (group of the picker), sent with it; NULL = model sent alone. */
    modelProvider: text('model_provider'),
    effort: text('effort'),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** Deleted, waiting for the undo window to pass (ms); 0 = taken by the purger. */
    deletedAt: integer('deleted_at'),
    /** Copy of another Hermes session (its id) or "import:<key>": exists at Hermes without a run from Intendia. */
    copiedFrom: text('copied_from'),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.sessionId] })],
);

/** One row per run started from Intendia: options asked for, then what Hermes reports at the end. */
export const runStats = sqliteTable(
  'run_stats',
  {
    instanceId: text('instance_id').notNull(),
    runId: text('run_id').notNull(),
    sessionId: text('session_id').notNull(),
    hermesSessionId: text('hermes_session_id'),
    /** "running" until settled, then the Hermes terminal status, or "unknown" (forgotten by Hermes). */
    status: text('status').notNull(),
    requestedModel: text('requested_model'),
    requestedEffort: text('requested_effort'),
    servedModel: text('served_model'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    costBeforeUsd: real('cost_before_usd'),
    costBeforeSessionId: text('cost_before_session_id'),
    costUsd: real('cost_usd'),
    costFinal: integer('cost_final', { mode: 'boolean' }).notNull().default(false),
    /** Runs covered by `costUsd`: more than 1 when the previous runs' costs were still settling at send time. */
    costRuns: integer('cost_runs').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.runId] }), index('run_stats_session').on(t.instanceId, t.sessionId, t.startedAt)],
);

export const shareLinks = sqliteTable('share_links', {
  token: text('token').primaryKey(),
  instanceId: text('instance_id').notNull(),
  path: text('path').notNull(),
  publicUntil: integer('public_until'),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const configVersions = sqliteTable('config_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  instanceId: text('instance_id').notNull(),
  profile: text('profile'),
  configJson: text('config_json').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const compatReports = sqliteTable('compat_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  instanceId: text('instance_id').notNull(),
  hermesVersion: text('hermes_version'),
  reportJson: text('report_json').notNull(),
  createdAt: integer('created_at').notNull(),
});
