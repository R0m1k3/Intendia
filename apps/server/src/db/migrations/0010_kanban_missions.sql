-- Lot 9 C (supervised missions): a pointer to a kanban root task that Hermes splits into children. Which children
-- are held is read at Hermes (status `scheduled` with Intendia's reason), never copied here.
CREATE TABLE kanban_missions (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  board TEXT NOT NULL,
  root_id TEXT,
  goal TEXT NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  decompose_started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX kanban_missions_board ON kanban_missions (instance_id, board, created_at);
