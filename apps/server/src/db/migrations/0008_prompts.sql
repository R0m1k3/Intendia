-- Prompts saved from the composer (kind 'prompt') and personalities written in Intendia (kind 'personality', lot 4).
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX prompts_kind ON prompts (kind, title);
