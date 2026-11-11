/**
 * The only place where a path chosen by the browser or the agent is checked before it reaches Hermes.
 * Browser paths are relative to a workspace folder; agent paths are absolute (under the workspace root of
 * the instance, the managed files root of its Hermes). Hermes itself confines every path to that root.
 */
import { WorkspaceFsError } from '../workspaces/fs.js';

export const PATH_MAX = 1024;
export const NAME_MAX_BYTES = 255;

/**
 * Normalizes a workspace-relative path: "/" separators, no leading/trailing "/" nor "." segments.
 * Refuses NUL, "..", backslashes, absolute paths and over-long input. "" is the workspace root.
 */
export function normalizeRel(rel: string, opts: { allowRoot?: boolean } = {}): string {
  if (typeof rel !== 'string' || rel.length > PATH_MAX || rel.includes('\0') || rel.includes('\\')) {
    throw new WorkspaceFsError('invalid', 'Chemin invalide');
  }
  if (rel.startsWith('/')) throw new WorkspaceFsError('invalid', `Chemin invalide : ${rel}`);
  const parts = rel.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new WorkspaceFsError('invalid', `Chemin invalide : ${rel}`);
  const out = parts.join('/');
  if (!out && !opts.allowRoot) throw new WorkspaceFsError('invalid', 'Chemin vide');
  return out;
}

/** A single file or folder name (upload, rename target segment). */
export function checkName(name: string): string {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name) || Buffer.byteLength(name, 'utf8') > NAME_MAX_BYTES) {
    throw new WorkspaceFsError('invalid', `Nom invalide : ${name.slice(0, 80)}`);
  }
  return name;
}

/**
 * An absolute path as written by the agent, under the workspace root `root` → volume path
 * ("<slug>/sessions/…"), or null when it is outside the root.
 */
export function toVolumePath(abs: string, root: string): string | null {
  if (typeof abs !== 'string' || !abs.startsWith('/') || abs.length > PATH_MAX || abs.includes('\0')) return null;
  const b = root.replace(/\/+$/, '');
  if (!abs.startsWith(`${b}/`)) return null;
  try {
    return normalizeRel(abs.slice(b.length + 1));
  } catch {
    return null;
  }
}
