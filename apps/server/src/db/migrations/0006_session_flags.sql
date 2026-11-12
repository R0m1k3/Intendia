-- Pinned sessions (Intendia only), deletion with undo (deleted_at in ms; 0 = taken by the purger, no longer
-- restorable) and copies (copied_from = id of the original, or "import:<key>" for a file: the session exists at
-- Hermes even without a run from Intendia).
ALTER TABLE session_workspace ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_workspace ADD COLUMN deleted_at INTEGER;
ALTER TABLE session_workspace ADD COLUMN copied_from TEXT;
-- Next purge attempt of a row taken by the purger (lease, then retry once a minute after a failure).
ALTER TABLE session_workspace ADD COLUMN purge_after INTEGER;
