-- Provider of the model chosen in the chat (the group of the picker it came from), per session and as the last
-- choice of each workspace. NULL = no provider sent with the model (sessions created before, or Auto).
ALTER TABLE session_workspace ADD COLUMN model_provider TEXT;
ALTER TABLE workspaces ADD COLUMN model_provider TEXT;
