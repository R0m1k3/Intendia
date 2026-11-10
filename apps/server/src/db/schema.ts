import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  model: text('model'),
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
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.sessionId] })],
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
