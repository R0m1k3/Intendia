-- Lot 4 (composer settings): personality chosen for a session ('hermes:<name>' or 'intendia:<prompt id>'), « Sans
-- confirmation » (approvals answered by Intendia), Hermes profile of the session (NULL = the workspace's default
-- profile), and the count of approvals Intendia gave for a run.
ALTER TABLE session_workspace ADD COLUMN personality TEXT;
ALTER TABLE session_workspace ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_workspace ADD COLUMN profile TEXT;
ALTER TABLE run_stats ADD COLUMN auto_approved INTEGER NOT NULL DEFAULT 0;
