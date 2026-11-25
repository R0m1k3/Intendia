-- API server keys of Hermes profiles made by Intendia ("Connecter à Intendia"): Intendia writes API_SERVER_KEY in the
-- profile's .env through the dashboard and keeps the key here, encrypted with INTENDIA_SECRET. Added to the
-- instance's profileKeys; a key declared in the configuration wins.
CREATE TABLE profile_keys (
  instance_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (instance_id, profile)
);
