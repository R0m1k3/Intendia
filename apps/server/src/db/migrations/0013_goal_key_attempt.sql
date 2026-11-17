-- Rank of the Idempotency-Key of a goal's relaunches (chat/goal.ts goalKeySuffix): raised when Hermes refused the
-- key (already admitted with another body), so the resume after that pause derives another key.
ALTER TABLE session_goals ADD COLUMN key_attempt INTEGER NOT NULL DEFAULT 0;
