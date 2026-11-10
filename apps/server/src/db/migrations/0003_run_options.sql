-- Chat run options: model and reasoning effort per session (NULL = Hermes default), the last choice of each
-- workspace (starting point of its new sessions), and one consumption row per run started from Intendia.
ALTER TABLE session_workspace ADD COLUMN model TEXT;
ALTER TABLE session_workspace ADD COLUMN effort TEXT;
-- existing sessions keep the model they use today (it came from their workspace)
UPDATE session_workspace SET model = (SELECT model FROM workspaces WHERE workspaces.slug = session_workspace.workspace_slug);
ALTER TABLE workspaces ADD COLUMN effort TEXT;

CREATE TABLE run_stats (
  instance_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  hermes_session_id TEXT,
  status TEXT NOT NULL,
  requested_model TEXT,
  requested_effort TEXT,
  served_model TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost_before_usd REAL,
  cost_before_session_id TEXT,
  cost_usd REAL,
  cost_final INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (instance_id, run_id)
);
CREATE INDEX run_stats_session ON run_stats (instance_id, session_id, started_at);
