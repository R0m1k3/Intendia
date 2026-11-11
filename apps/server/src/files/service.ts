/**
 * Files of a workspace, read from its Hermes on each request (no list in the database, no watcher).
 * Every browser path goes through files/paths.ts, every Hermes call through files/hermes-fs.ts.
 */
import type { InstanceConfig } from '../config.js';
import { LinkService } from '../links/service.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import type { Workspace, WorkspaceService } from '../workspaces/service.js';
import { mapLimit, type FileRoots, type FsEntry, type HermesFs } from './hermes-fs.js';
import { checkName, normalizeRel, toVolumePath } from './paths.js';

export const LIST_MAX = 2000;
export const SEARCH_VISIT_MAX = 20_000;
export const SEARCH_RESULTS_MAX = 200;
export const SEARCH_MAX_MS = 5_000;
export const TEXT_MAX_BYTES = 1024 * 1024;
export const EXISTS_MAX = 200;
const PARALLEL = 4;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const PROTECTED = new Set(['files', 'inbox', 'sessions', 'AGENTS.md']);

export interface FileEntry {
  name: string;
  /** Relative to the workspace. */
  path: string;
  kind: 'file' | 'dir' | 'link';
  /** For a symbolic link whose target stays in the workspace (not set any more: links are never followed). */
  target?: 'file' | 'dir';
  /** Symbolic link: not openable, never written, moved nor deleted. */
  outside?: true;
  size: number;
  /** Milliseconds, floored. */
  mtime: number;
}

interface WsCtx {
  ws: Workspace;
  inst: InstanceConfig;
  fs: HermesFs;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const join2 = (a: string, b: string) => (a ? `${a}/${b}` : b);
const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

export function toFileEntry(e: FsEntry, rel: string): FileEntry {
  const path = join2(rel, e.name);
  if (e.isLink) return { name: e.name, path, kind: 'link', outside: true, size: 0, mtime: e.mtimeMs };
  return { name: e.name, path, kind: e.isDir ? 'dir' : 'file', size: e.isDir ? 0 : e.size, mtime: e.mtimeMs };
}

export class FileService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly links: LinkService,
    private readonly roots: FileRoots,
    private readonly uploadMaxBytes: number,
  ) {}

  private ctx(slug: string): WsCtx {
    const ws = this.workspaces.getWorkspace(slug);
    return { ws, inst: this.workspaces.instanceOf(ws), fs: this.roots.fs(ws.instanceId) };
  }

  private vol(c: WsCtx, rel: string): string {
    return LinkService.volumeRel(c.ws.slug, rel);
  }

  private agentPath(c: WsCtx, rel: string): string {
    return `${c.fs.root}/${this.vol(c, rel)}`;
  }

  private async mustEntry(c: WsCtx, rel: string): Promise<FsEntry> {
    const e = await c.fs.entry(this.vol(c, rel));
    if (!e) throw new WorkspaceFsError('not_found', `Introuvable : ${rel}`);
    return e;
  }

  async list(slug: string, relIn: string): Promise<{ path: string; entries: FileEntry[]; truncated: boolean }> {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn, { allowRoot: true });
    const { entries: all } = await c.fs.list(this.vol(c, rel));
    const truncated = all.length > LIST_MAX;
    const entries = all.slice(0, LIST_MAX).map((e) => toFileEntry(e, rel));
    const isDir = (e: FileEntry) => e.kind === 'dir';
    entries.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.localeCompare(b.name, 'fr'));
    return { path: rel, entries, truncated };
  }

  /** Name search, breadth first, 4 folders at a time, symbolic links not followed; bounded in entries, results and time. */
  async search(slug: string, q: string): Promise<{ results: FileEntry[]; truncated: boolean }> {
    const c = this.ctx(slug);
    return searchTree(async (rel) => (await c.fs.list(this.vol(c, rel))).entries, q);
  }

  /** A regular file to stream (raw view). */
  async read(slug: string, relIn: string, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; size: number | null; name: string }> {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    const { body, size } = await c.fs.read(this.vol(c, rel), { signal });
    return { body, size, name: nameOf(rel) };
  }

  /**
   * Entries of an upload folder, created (with its parents) when missing: a workspace made before the files moved
   * into Hermes (0.0.4) has no folder there yet, and pasting into the chat must still work.
   */
  private async listOrCreate(c: WsCtx, dir: string): Promise<FsEntry[]> {
    try {
      return (await c.fs.list(this.vol(c, dir))).entries;
    } catch (err) {
      if (!(err instanceof WorkspaceFsError && err.code === 'not_found')) throw err;
      await c.fs.mkdir(this.vol(c, dir));
      return [];
    }
  }

  /** Streams a body into dir/name (name (2).ext… when the name is taken), at most uploadMaxBytes. */
  async upload(
    slug: string, dirIn: string, nameIn: string, body: ReadableStream<Uint8Array> | null, signal?: AbortSignal,
  ): Promise<{ path: string; agentPath: string }> {
    const c = this.ctx(slug);
    const dir = normalizeRel(dirIn, { allowRoot: true });
    const name = checkName(nameIn);
    const taken = new Set((await this.listOrCreate(c, dir)).map((e) => e.name));
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let rel = '';
    for (let n = 1; n <= 99 && !rel; n++) {
      const candidate = checkName(n === 1 ? name : `${stem} (${n})${ext}`);
      if (!taken.has(candidate)) rel = join2(dir, candidate);
    }
    if (!rel) throw new WorkspaceFsError('exists', `Trop de fichiers nommés ${name}`);
    try {
      // the browser stream can only be read once: a 409 from Hermes is final, no other name is tried
      await c.fs.create(this.vol(c, rel), body, { overwrite: false, maxBytes: this.uploadMaxBytes, signal });
    } catch (err) {
      if (err instanceof WorkspaceFsError && err.code === 'exists') throw new WorkspaceFsError('exists', 'Un fichier de ce nom existe déjà dans Hermes');
      throw err;
    }
    return { path: rel, agentPath: this.agentPath(c, rel) };
  }

  /**
   * Moves a file inside the workspace, never overwriting: copy, then share links follow, then the source is
   * deleted. Hermes cannot move a folder (409 `unsupported`).
   */
  async move(slug: string, fromIn: string, toIn: string): Promise<{ path: string }> {
    const c = this.ctx(slug);
    const from = normalizeRel(fromIn);
    const to = normalizeRel(toIn);
    if (PROTECTED.has(from)) throw new WorkspaceFsError('invalid', `${from} ne peut pas être déplacé`);
    if (to === from || to.startsWith(`${from}/`)) throw new WorkspaceFsError('invalid', 'Un dossier ne peut pas aller dans lui-même');
    checkName(nameOf(to));
    const src = await this.mustEntry(c, from);
    if (src.isLink) throw new WorkspaceFsError('outside', `${from} : c'est un lien symbolique ; Intendia ne le modifie pas`);
    if (src.isDir) throw new WorkspaceFsError('unsupported', 'Hermes ne permet pas de déplacer un dossier');
    const parent = await c.fs.entry(this.vol(c, parentOf(to)));
    if (parentOf(to) && (!parent || !parent.isDir)) throw new WorkspaceFsError('not_found', `Dossier introuvable : ${parentOf(to)}`);
    if (await c.fs.entry(this.vol(c, to))) throw new WorkspaceFsError('exists', `Existe déjà : ${to}`);
    const { body } = await c.fs.read(this.vol(c, from));
    await c.fs.create(this.vol(c, to), body, { overwrite: false });
    c.fs.forget(this.vol(c, parentOf(from)));
    const now = await c.fs.entry(this.vol(c, from));
    if (!now || now.isLink || now.size !== src.size || now.mtimeMs !== src.mtimeMs) {
      await c.fs.remove(this.vol(c, to), false).catch(() => undefined);
      throw new WorkspaceFsError('exists', `${from} a changé pendant le déplacement : rien n'a été déplacé, réessayer`);
    }
    this.links.rewritePaths(c.inst.id, this.vol(c, from), this.vol(c, to));
    try {
      await c.fs.remove(this.vol(c, from), false);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new WorkspaceFsError(err instanceof WorkspaceFsError ? err.code : 'unreachable',
        `Copié vers ${to}, mais ${from} n'a pas pu être supprimé (${why}) : le fichier est en double, les liens pointent sur la copie`);
    }
    return { path: to };
  }

  async remove(slug: string, relIn: string): Promise<void> {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    if (PROTECTED.has(rel)) throw new WorkspaceFsError('invalid', `${rel} ne peut pas être supprimé`);
    const e = await this.mustEntry(c, rel);
    await c.fs.remove(this.vol(c, rel), e.isDir);
  }

  /** Saves an existing text file, unless it changed since it was read (mtime). */
  async writeText(slug: string, relIn: string, text: string, mtime: number): Promise<{ mtime: number }> {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    if (Buffer.byteLength(text, 'utf8') > TEXT_MAX_BYTES) throw new WorkspaceFsError('too_large', 'Fichier texte limité à 1 Mio');
    const e = await this.mustEntry(c, rel);
    if (e.isLink) throw new WorkspaceFsError('outside', `${rel} : c'est un lien symbolique ; Intendia ne le modifie pas`);
    if (e.isDir) throw new WorkspaceFsError('not_file', `Pas un fichier : ${rel}`);
    if (e.mtimeMs !== mtime) throw new WorkspaceFsError('exists', 'Modifié sur le disque depuis l’ouverture : recharger');
    const saved = await c.fs.create(this.vol(c, rel), text, { overwrite: true });
    return { mtime: saved.mtimeMs };
  }

  /** Paths as written in the chat → workspace-relative path and kind, or null. One listing per parent folder. */
  async exists(slug: string, paths: string[]): Promise<Record<string, { path: string; kind: 'file' | 'dir' } | null>> {
    const c = this.ctx(slug);
    const out: Record<string, { path: string; kind: 'file' | 'dir' } | null> = {};
    const byParent = new Map<string, { written: string; rel: string }[]>();
    for (const written of paths.slice(0, EXISTS_MAX)) {
      out[written] = null;
      let rel: string;
      try {
        if (written.startsWith('/')) {
          const vol = toVolumePath(written, c.fs.root);
          if (vol === null) continue;
          if (vol === c.ws.slug) rel = '';
          else if (vol.startsWith(`${c.ws.slug}/`)) rel = vol.slice(c.ws.slug.length + 1);
          else continue;
        } else {
          rel = normalizeRel(written, { allowRoot: false });
        }
      } catch {
        continue;
      }
      if (rel === '') {
        out[written] = { path: '', kind: 'dir' };
        continue;
      }
      const parent = parentOf(rel);
      byParent.set(parent, [...(byParent.get(parent) ?? []), { written, rel }]);
    }
    await mapLimit([...byParent.entries()], PARALLEL, async ([parent, items]) => {
      let entries: FsEntry[];
      try {
        entries = (await c.fs.list(this.vol(c, parent))).entries;
      } catch {
        return; // missing, unreadable or Hermes down: null
      }
      for (const { written, rel } of items) {
        const e = entries.find((x) => x.name === nameOf(rel));
        if (e && !e.broken) out[written] = { path: rel, kind: e.isDir ? 'dir' : 'file' };
      }
    });
    return out;
  }

  /** "Partager" in the explorer: any live link is returned as it is. */
  async share(slug: string, relIn: string) {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    const row = await this.links.share(c.inst.id, this.vol(c, rel), { forAgent: false });
    return { token: row.token, url: this.links.url(row.token), publicUntil: row.publicUntil };
  }
}

/**
 * Name search from a folder, breadth first, 4 folders at a time, symbolic links not followed; bounded in entries,
 * results and time. `list(rel)` gives the entries of a folder relative to the starting point.
 */
export async function searchTree(list: (rel: string) => Promise<FsEntry[]>, q: string): Promise<{ results: FileEntry[]; truncated: boolean }> {
  const needle = fold(q.trim());
  if (!needle) return { results: [], truncated: false };
  const results: FileEntry[] = [];
  const deadline = Date.now() + SEARCH_MAX_MS;
  let level = [''];
  let visited = 0;
  let truncated = false;
  while (level.length && !truncated) {
    const next: string[] = [];
    await mapLimit(level, PARALLEL, async (rel) => {
      if (truncated) return;
      if (Date.now() > deadline) {
        truncated = true;
        return;
      }
      let entries: FsEntry[];
      try {
        entries = await list(rel);
      } catch {
        return; // unreadable folder: skipped
      }
      for (const e of entries) {
        if (truncated) return;
        if (++visited > SEARCH_VISIT_MAX) {
          truncated = true;
          return;
        }
        if (fold(e.name).includes(needle)) {
          results.push(toFileEntry(e, rel));
          if (results.length >= SEARCH_RESULTS_MAX) {
            truncated = true;
            return;
          }
        }
        if (e.isDir && !e.isLink && !SKIP_DIRS.has(e.name)) next.push(join2(rel, e.name));
      }
    });
    level = next;
  }
  return { results, truncated };
}
