// `?retour=` of the sign-in page: where to go back after signing in. Only a path of this app, never another site.

const BLOCKED = /^\/(connexion|installation)(\/|$|\?|#)/;

/** The path to go back to (`pathname + search + hash`), or null when `raw` is missing or not a safe local path. */
export function retourOf(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  // backslash (read as `/` by browsers), spaces and control characters
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== new URL(origin).origin) return null;
  if (BLOCKED.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}
