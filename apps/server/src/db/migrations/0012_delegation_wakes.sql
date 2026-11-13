-- Automatic wake of the agent once its background sub-agents delivered (chat/wake.ts): one row per delivery the
-- server answered, so a delivery is never answered twice (a wake run that fails at Hermes keeps no message, the
-- history alone would wake again), and the rank of the wake in a chain without any other run (5 at most).
CREATE TABLE delegation_wakes (
  instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  -- id of Hermes' last message of the delivery (m:<id>), else d:<delegation id>:<timestamp>
  delivery_key TEXT NOT NULL,
  -- starting | started | abandoned
  state TEXT NOT NULL,
  run_id TEXT,
  chain INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, session_id, delivery_key)
);
