-- A run started while the previous run's cost was still settling shares its baseline: its cost then covers
-- several runs (this one and the previous ones whose own cost stays unknown). 1 = the run alone.
ALTER TABLE run_stats ADD COLUMN cost_runs INTEGER NOT NULL DEFAULT 1;
