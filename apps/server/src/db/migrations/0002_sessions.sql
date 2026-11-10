-- Phase 2: last run of each session (stream resume) and local activity time (sorting without Hermes).
ALTER TABLE session_workspace ADD COLUMN last_run_id TEXT;
ALTER TABLE session_workspace ADD COLUMN last_active_at INTEGER;
