// The browser_vault tool of Hermes cannot ask the user for a login in an API server session (Intendia's): it answers
// `error_type: "prompt_unavailable"` and names the site at the end of its message. That result opens a link to the
// "Accès" page, with the site when it can be read. Found in the raw text: a live preview may be cut.

const PROMPT_UNAVAILABLE = /"error_type"\s*:\s*"prompt_unavailable"/;
const SITE = /for (https?:\/\/[^\s"]+?)\.?"/;

export function vaultHint(tool: string, result: string | null): { origin: string | null } | null {
  if (tool !== 'browser_vault' || !result || !PROMPT_UNAVAILABLE.test(result)) return null;
  const raw = SITE.exec(result)?.[1];
  if (!raw) return { origin: null };
  try {
    const u = new URL(raw);
    return { origin: u.protocol === 'http:' || u.protocol === 'https:' ? `${u.protocol}//${u.host}` : null };
  } catch {
    return { origin: null };
  }
}
