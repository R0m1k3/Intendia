/**
 * Files of a workspace, read from the disk on each request (no list in the database, no watcher).
 * Every path goes through files/paths.ts.
 */
import {
  chmodSync, createWriteStream, lstatSync, openSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { InstanceConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { LinkService } from '../links/service.js';
import { FILE_MODE, WorkspaceFsError } from '../workspaces/fs.js';
import type { Workspace, WorkspaceService } from '../workspaces/service.js';
import { checkName, normalizeRel, realRoot, resolveEntry, resolveInside, toVolumePath, within } from './paths.js';

export const LIST_MAX = 2000;
export const SEARCH_VISIT_MAX = 20_000;
export const SEARCH_RESULTS_MAX = 200;
export const TEXT_MAX_BYTES = 1024 * 1024;
export const EXISTS_MAX = 200;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const PROTECTED = new Set(['files', 'inbox', 'sessions', 'AGENTS.md']);

export interface FileEntry {
  name: string;
  /** Relative to the workspace. */
  path: string;
  kind: 'file' | 'dir' | 'link';
  /** For a symbolic link whose target stays in the workspace. */
  target?: 'file' | 'dir';
  /** Symbolic link that leaves the workspace or is broken: not openable. */
  outside?: true;
  size: number;
  /** Milliseconds, floored. */
  mtime: number;
}

interface WsCtx {
  ws: Workspace;
  inst: InstanceConfig;
  /** {mount}/{slug} */
  dir: string;
  /** realpath of dir */
  real: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const mtimeOf = (st: Stats) => Math.floor(st.mtimeMs);
const join2 = (a: string, b: string) => (a ? `${a}/${b}` : b);

export class FileService {
  constructor(
    private readonly db: Db,
    private readonly workspaces: WorkspaceService,
    private readonly links: LinkService,
    private readonly uploadMaxBytes: number,
  ) {}

  private ctx(slug: string): WsCtx {
    const ws = this.workspaces.getWorkspace(slug);
    const dir = this.workspaces.dir(ws);
    return { ws, inst: this.workspaces.instanceOf(ws), dir, real: realRoot(dir) };
  }

  agentPath(c: WsCtx, rel: string): string {
    return rel ? `${this.workspaces.agentPath(c.ws)}/${rel}` : this.workspaces.agentPath(c.ws);
  }

  private entry(c: WsCtx, parentRel: string, name: string, abs: string): FileEntry {
    const path = join2(parentRel, name);
    const l = lstatSync(abs);
    if (!l.isSymbolicLink()) {
      return { name, path, kind: l.isDirectory() ? 'dir' : 'file', size: l.isDirectory() ? 0 : l.size, mtime: mtimeOf(l) };
    }
    try {
      const real = realpathSync(abs);
      if (!within(c.real, real)) throw new Error('outside');
      const st = statSync(real);
      return { name, path, kind: 'link', target: st.isDirectory() ? 'dir' : 'file', size: st.isDirectory() ? 0 : st.size, mtime: mtimeOf(st) };
    } catch {
      return { name, path, kind: 'link', outside: true, size: 0, mtime: mtimeOf(l) };
    }
  }

  list(slug: string, relIn: string): { path: string; entries: FileEntry[]; truncated: boolean } {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn, { allowRoot: true });
    const abs = resolveInside(c.dir, rel, 'existing');
    if (!statSync(abs).isDirectory()) throw new WorkspaceFsError('not_file', `Pas un dossier : ${rel}`);
    const names = readdirSync(abs);
    const truncated = names.length > LIST_MAX;
    const entries: FileEntry[] = [];
    for (const name of names.slice(0, LIST_MAX)) {
      try {
        entries.push(this.entry(c, rel, name, join(abs, name)));
      } catch {
        // vanished between readdir and lstat
      }
    }
    const isDir = (e: FileEntry) => e.kind === 'dir' || e.target === 'dir';
    entries.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.localeCompare(b.name, 'fr'));
    return { path: rel, entries, truncated };
  }

  /** Name search, breadth first, symbolic links not followed. */
  search(slug: string, q: string): { results: FileEntry[]; truncated: boolean } {
    const c = this.ctx(slug);
    const needle = fold(q.trim());
    if (!needle) return { results: [], truncated: false };
    const results: FileEntry[] = [];
    const queue: string[] = [''];
    let visited = 0;
    while (queue.length) {
      const rel = queue.shift()!;
      let dirents;
      try {
        dirents = readdirSync(rel ? join(c.real, rel) : c.real, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of dirents) {
        if (++visited > SEARCH_VISIT_MAX) return { results, truncated: true };
        const path = join2(rel, d.name);
        if (fold(d.name).includes(needle)) {
          try {
            results.push(this.entry(c, rel, d.name, join(c.real, path)));
          } catch {
            // vanished
          }
          if (results.length >= SEARCH_RESULTS_MAX) return { results, truncated: true };
        }
        if (d.isDirectory() && !SKIP_DIRS.has(d.name)) queue.push(path);
      }
    }
    return { results, truncated: false };
  }

  /** A regular file to stream (raw view). */
  resolveForRead(slug: string, relIn: string): { abs: string; name: string } {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    const abs = resolveInside(c.dir, rel, 'existing');
    if (!statSync(abs).isFile()) throw new WorkspaceFsError('not_file', `Pas un fichier : ${rel}`);
    return { abs, name: basename(rel) };
  }

  /** Streams a body into dir/name (name (2).ext… on collision), at most uploadMaxBytes. */
  async upload(slug: string, dirIn: string, nameIn: string, body: ReadableStream<Uint8Array> | null): Promise<{ path: string; agentPath: string }> {
    const c = this.ctx(slug);
    const dir = normalizeRel(dirIn, { allowRoot: true });
    const name = checkName(nameIn);
    const dirAbs = resolveInside(c.dir, dir, 'existing');
    if (!statSync(dirAbs).isDirectory()) throw new WorkspaceFsError('not_file', `Pas un dossier : ${dir}`);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    // the name is reserved by an exclusive create (wx): a concurrent upload of the same name moves on to
    // the next candidate, and the cleanup below only ever removes the file this request created
    let target = '';
    let rel = '';
    let fd = -1;
    for (let n = 1; n <= 99 && fd < 0; n++) {
      const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
      try {
        rel = join2(dir, checkName(candidate));
        target = resolveInside(c.dir, rel, 'create');
        fd = openSync(target, 'wx', FILE_MODE);
      } catch (err) {
        const taken = (err instanceof WorkspaceFsError && err.code === 'exists') || (err as NodeJS.ErrnoException).code === 'EEXIST';
        if (!taken) throw err;
      }
    }
    if (fd < 0) throw new WorkspaceFsError('exists', `Trop de fichiers nommés ${name}`);

    const max = this.uploadMaxBytes;
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) cb(new WorkspaceFsError('too_large', `Fichier trop gros (${Math.round(max / 1048576)} Mo au plus)`));
        else cb(null, chunk);
      },
    });
    const out = createWriteStream(target, { fd });
    try {
      const src = body ? Readable.fromWeb(body as import('node:stream/web').ReadableStream) : Readable.from([]);
      await pipeline(src, limit, out);
      chmodSync(target, FILE_MODE);
    } catch (err) {
      try {
        unlinkSync(target); // created by this request (wx above)
      } catch {
        // already gone
      }
      throw err;
    }
    return { path: rel, agentPath: this.agentPath(c, rel) };
  }

  /** Rename or move inside the workspace, never overwriting; share links follow in the same transaction. */
  move(slug: string, fromIn: string, toIn: string): { path: string } {
    const c = this.ctx(slug);
    const from = normalizeRel(fromIn);
    const to = normalizeRel(toIn);
    if (PROTECTED.has(from)) throw new WorkspaceFsError('invalid', `${from} ne peut pas être déplacé`);
    if (to === from || to.startsWith(`${from}/`)) throw new WorkspaceFsError('invalid', 'Un dossier ne peut pas aller dans lui-même');
    const src = resolveEntry(c.dir, from);
    const dst = resolveInside(c.dir, to, 'create');
    this.db.transaction(() => {
      this.links.rewritePaths(c.inst.id, LinkService.volumeRel(c.ws.slug, from), LinkService.volumeRel(c.ws.slug, to));
      renameSync(src, dst); // last: if it throws, the link update rolls back
    });
    return { path: to };
  }

  remove(slug: string, relIn: string): void {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    if (PROTECTED.has(rel)) throw new WorkspaceFsError('invalid', `${rel} ne peut pas être supprimé`);
    rmSync(resolveEntry(c.dir, rel), { recursive: true, force: false });
  }

  /** Saves an existing text file, unless the disk changed since it was read (mtime). */
  writeText(slug: string, relIn: string, text: string, mtime: number): { mtime: number } {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    if (Buffer.byteLength(text, 'utf8') > TEXT_MAX_BYTES) throw new WorkspaceFsError('too_large', 'Fichier texte limité à 1 Mio');
    const abs = resolveInside(c.dir, rel, 'existing');
    const st = statSync(abs);
    if (!st.isFile()) throw new WorkspaceFsError('not_file', `Pas un fichier : ${rel}`);
    if (mtimeOf(st) !== mtime) throw new WorkspaceFsError('exists', 'Modifié sur le disque depuis l’ouverture : recharger');
    writeFileSync(abs, text);
    return { mtime: mtimeOf(statSync(abs)) };
  }

  /** Paths as written in the chat → workspace-relative path and kind, or null. */
  exists(slug: string, paths: string[]): Record<string, { path: string; kind: 'file' | 'dir' } | null> {
    const c = this.ctx(slug);
    const out: Record<string, { path: string; kind: 'file' | 'dir' } | null> = {};
    for (const written of paths.slice(0, EXISTS_MAX)) {
      out[written] = null;
      try {
        let rel: string;
        if (written.startsWith('/')) {
          const vol = toVolumePath(written, c.inst);
          if (vol === null) continue;
          if (vol === c.ws.slug) rel = '';
          else if (vol.startsWith(`${c.ws.slug}/`)) rel = vol.slice(c.ws.slug.length + 1);
          else continue;
        } else {
          rel = normalizeRel(written, { allowRoot: false });
        }
        const st = statSync(resolveInside(c.dir, rel, 'existing'));
        out[written] = { path: rel, kind: st.isDirectory() ? 'dir' : 'file' };
      } catch {
        // invalid, missing or outside: null
      }
    }
    return out;
  }

  /** "Partager" in the explorer: any live link is returned as it is. */
  share(slug: string, relIn: string) {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    const row = this.links.share(c.inst.id, LinkService.volumeRel(c.ws.slug, rel), { forAgent: false });
    return { token: row.token, url: this.links.url(row.token), publicUntil: row.publicUntil };
  }
}
