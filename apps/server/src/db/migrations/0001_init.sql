-- Intendia initial schema. Rule: later migrations only ADD tables or columns,
-- so going back to the previous image works without a restore.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Instances added through the setup wizard (keys encrypted with INTENDIA_SECRET).
-- Ignored when INTENDIA_INSTANCES is set.
CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  config_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE workspaces (
  slug TEXT PRIMARY KEY CHECK (length(slug) <= 40),
  name TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  profile TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE session_workspace (
  session_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  workspace_slug TEXT NOT NULL REFERENCES workspaces(slug),
  title TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, session_id)
);

CREATE TABLE share_links (
  token TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  path TEXT NOT NULL,
  public_until INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX share_links_path ON share_links(instance_id, path);

CREATE TABLE config_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  profile TEXT,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Last compatibility report per instance (history kept short by the app).
CREATE TABLE compat_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  hermes_version TEXT,
  report_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX compat_reports_instance ON compat_reports(instance_id, created_at);
