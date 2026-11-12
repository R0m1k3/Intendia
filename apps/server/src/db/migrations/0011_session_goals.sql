-- Option 7 (/goal): a persistent goal per Intendia session, relaunched by Intendia's server loop (chat/goal.ts) until
-- the agent ends a reply with « OBJECTIF ATTEINT », within a relaunch cap and an optional budget.
CREATE TABLE session_goals (
  instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  -- active | paused | done
  status TEXT NOT NULL,
  -- auto | click
  mode TEXT NOT NULL,
  max_relaunches INTEGER NOT NULL,
  relaunches INTEGER NOT NULL DEFAULT 0,
  -- NULL = no budget
  budget_usd REAL,
  -- ms: run_stats rows started at or after it count in the goal's cost
  cost_since INTEGER NOT NULL,
  -- last run of the session already decided on
  handled_run_id TEXT,
  -- user | button | click | blocked | failed | stopped | lost | limit | budget | start_failed | gone | cost_unknown
  reason TEXT,
  reason_detail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, session_id)
);
