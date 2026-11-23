-- The session personality (lot 4, option 9) is gone: personalities written in Intendia and the session column.
DELETE FROM prompts WHERE kind = 'personality';
ALTER TABLE session_workspace DROP COLUMN personality;
