-- Session made by "Modifier", "Réessayer", "Annuler le dernier échange" or "Vider": id of the session it replaces
-- (deleted with the undo window). Lets "Annuler" bring the original back.
ALTER TABLE session_workspace ADD COLUMN replaces_id TEXT;
