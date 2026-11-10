/**
 * The only place where a path chosen by the browser or the agent becomes a path on disk.
 * Browser paths are relative to a workspace folder; agent paths are absolute (agentMount or mount).
 * Known limit: between the realpath check and the open, the agent could swap a folder for a symbolic
 * link (Node has no openat / O_NOFOLLOW per segment); the guard covers forged paths, not that race.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { InstanceConfig } from '../config.js';
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

function isInside(root: string, real: string): boolean {
  return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
}

function realOr404(abs: string, rel: string): string {
  try {
    return realpathSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') throw new WorkspaceFsError('not_found', `Introuvable : ${rel || '/'}`);
    throw err;
  }
}

export function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    throw new WorkspaceFsError('mount', `Dossier ${root} introuvable`);
  }
}

/**
 * Resolves `rel` (already normalized) under `root`.
 * - 'existing': the target must exist; its realpath (symbolic links followed) must stay under root.
 * - 'create': the parent must exist and stay under root; the last segment must not exist at all
 *   (a dangling symbolic link counts as existing). Write with flag 'wx' afterwards.
 * Returns the real path ('existing') or realParent/name ('create').
 */
export function resolveInside(root: string, rel: string, mode: 'existing' | 'create'): string {
  const rootReal = realRoot(root);
  if (mode === 'existing') {
    const real = realOr404(join(rootReal, rel), rel);
    if (!isInside(rootReal, real)) throw new WorkspaceFsError('outside', `Hors du workspace : ${rel}`);
    return real;
  }
  if (!rel) throw new WorkspaceFsError('invalid', 'Chemin vide');
  const cut = rel.lastIndexOf('/');
  const parentRel = cut < 0 ? '' : rel.slice(0, cut);
  const name = checkName(cut < 0 ? rel : rel.slice(cut + 1));
  const parent = realOr404(join(rootReal, parentRel), parentRel);
  if (!isInside(rootReal, parent)) throw new WorkspaceFsError('outside', `Hors du workspace : ${rel}`);
  const target = join(parent, name);
  try {
    lstatSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return target;
    throw err;
  }
  throw new WorkspaceFsError('exists', `Existe déjà : ${rel}`);
}

/**
 * An existing entry addressed by itself, without following a final symbolic link: the parent is resolved
 * (and must stay under root), the last segment is kept as is. For delete and move, so that removing or
 * moving a symbolic link acts on the link, never on its target.
 */
export function resolveEntry(root: string, rel: string): string {
  if (!rel) throw new WorkspaceFsError('invalid', 'Chemin vide');
  const cut = rel.lastIndexOf('/');
  const parentRel = cut < 0 ? '' : rel.slice(0, cut);
  const name = checkName(cut < 0 ? rel : rel.slice(cut + 1));
  const parent = resolveInside(root, parentRel, 'existing');
  const target = join(parent, name);
  try {
    lstatSync(target);
  } catch {
    throw new WorkspaceFsError('not_found', `Introuvable : ${rel}`);
  }
  return target;
}

/** True when the real path `real` is inside `root` (both real). */
export function within(rootReal: string, real: string): boolean {
  return isInside(rootReal, real);
}

/**
 * An absolute path as written by the agent (under agentMount) or as seen by Intendia (under mount)
 * → path relative to the mount ("<slug>/sessions/…"), or null when it is outside the volume.
 */
export function toVolumePath(abs: string, inst: Pick<InstanceConfig, 'mount' | 'agentMount'>): string | null {
  if (typeof abs !== 'string' || !abs.startsWith('/') || abs.length > PATH_MAX || abs.includes('\0')) return null;
  for (const base of [inst.agentMount, inst.mount]) {
    if (!base) continue;
    const b = base.replace(/\/+$/, '');
    if (abs.startsWith(`${b}/`)) {
      try {
        return normalizeRel(abs.slice(b.length + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
