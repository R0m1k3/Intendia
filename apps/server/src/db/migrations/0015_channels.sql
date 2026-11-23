-- Channels with several agents (OpenBot-like, lot 7): a thread kept by Intendia. Each member (an agent of an instance)
-- has its own hidden Intendia session; when its turn comes, Intendia sends it the channel's messages it has not seen
-- yet, then posts its answer in the channel. Turns are played one at a time per channel (channels/runner.ts).
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  -- handle of the lead: answers a message that names nobody, hands over with @handle
  lead TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE channel_members (
  channel_id TEXT NOT NULL,
  -- name used with @ in the channel (the profile, with the instance when two members share it)
  handle TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  session_id TEXT NOT NULL,
  -- last channel message sent to it (or written by it)
  seen_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, handle)
);
CREATE TABLE channel_messages (
  channel_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  -- 'user', 'system' or a member's handle
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, seq)
);
CREATE TABLE channel_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  -- queued | running | done | stopped | cancelled
  status TEXT NOT NULL,
  -- relays since the user's last message (5 at most)
  chain INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  -- why it stopped (failed, stopped, start error)
  detail TEXT,
  -- raised by « Continuer »: a new send key, so Hermes starts a new run
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX channel_turns_open ON channel_turns (channel_id, status);
