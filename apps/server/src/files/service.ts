/**
 * Files of a workspace, read from its Hermes on each request (no list in the database, no watcher).
 * Every browser path goes through files/paths.ts, every Hermes call through files/hermes-fs.ts.
 */
import type { InstanceConfig } from '../config.js';
import { LinkService } from '../links/service.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import type { Workspace, WorkspaceService } from '../workspaces/service.js';
import { mapLimit, type FileRoots, type FsEntry, type HermesFs } from './hermes-fs.js';
import { ArchiveError, archiveKind, archiveStem, extractArchive, precheckArchive, type Skipped } from './archive.js';
import { checkName, hiddenByHermes, normalizeRel, toVolumePath } from './paths.js';
import { FILE_READ_MAX, idleGuard, MOVE_MAX_BYTES, MOVE_MAX_FILES, walk, type WalkResult } from './walk.js';

export const LIST_MAX = 2000;
export const SEARCH_VISIT_MAX = 20_000;
export const SEARCH_RESULTS_MAX = 200;
export const SEARCH_MAX_MS = 5_000;
export const TEXT_MAX_BYTES = 1024 * 1024;
export const EXISTS_MAX = 200;
export const EXTRACT_MAX_ENTRIES = 2000;
export const EXTRACT_MAX_TOTAL = 500 * 1024 * 1024;
export const EXTRACT_MAX_MS = 10 * 60_000;
/** one extraction at a time on the server (memory: the archive plus one file) */
let extracting = false;
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

/** Test settings only. */
export interface FileServiceOpts {
  moveMaxFiles?: number;
  moveMaxBytes?: number;
  /** Called after a folder was copied, before the source is checked. */
  afterCopy?: () => Promise<void>;
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
/** `b` under `a`, `a` itself when `b` is empty. */
const under = (a: string, b: string) => (b ? `${a}/${b}` : a);
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

function sameTree(a: WalkResult, b: WalkResult): boolean {
  if (a.dirs.length !== b.dirs.length || a.files.length !== b.files.length) return false;
  const dirs = new Set(a.dirs);
  if (!b.dirs.every((d) => dirs.has(d))) return false;
  const files = new Map(a.files.map((f) => [f.rel, f]));
  return b.files.every((f) => {
    const o = files.get(f.rel);
    return !!o && o.size === f.size && o.mtimeMs === f.mtimeMs;
  });
}

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
    private readonly opts: FileServiceOpts = {},
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

  /**
   * New empty file or folder. A name kept by Intendia at the root (inbox, sessions…) is refused even when that
   * folder is missing; Hermes' mkdir accepts an existing folder, so the path is checked first.
   */
  async create(slug: string, relIn: string, kind: 'file' | 'dir'): Promise<{ path: string }> {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    if (PROTECTED.has(rel)) throw new WorkspaceFsError('invalid', `${rel} est un nom réservé à la racine du workspace`);
    checkName(nameOf(rel));
    const parent = parentOf(rel);
    if (parent) {
      const p = await c.fs.entry(this.vol(c, parent));
      if (!p || !p.isDir || p.isLink) throw new WorkspaceFsError('not_found', `Dossier introuvable : ${parent}`);
    }
    if (await c.fs.entry(this.vol(c, rel))) throw new WorkspaceFsError('exists', `Existe déjà : ${rel}`);
    if (kind === 'dir') await c.fs.mkdir(this.vol(c, rel));
    else await c.fs.create(this.vol(c, rel), '', { overwrite: false });
    return { path: rel };
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
   * Unpacks an archive of the workspace (.zip, .tar, .tar.gz, .tgz) into <its folder>/<name without extension>/
   * (" (2)"… when taken). One extraction at a time on the server; it goes on when the browser drops the request,
   * for at most EXTRACT_MAX_MS (then stops: files already written stay, `partial`).
   */
  async extract(slug: string, relIn: string): Promise<{ folder: string; count: number; skipped: Skipped[]; partial: boolean }> {
    const c = this.ctx(slug);
    const rel = normalizeRel(relIn);
    const name = nameOf(rel);
    const kind = archiveKind(name);
    if (!kind) throw new ArchiveError('invalid', 'Ce fichier n’est pas une archive .zip, .tar, .tar.gz ou .tgz');
    if (extracting) throw new ArchiveError('busy', 'Une autre archive est en cours de décompression, réessayez dans un instant');
    extracting = true;
    try {
      const started = Date.now();
      const bytes = await this.readBytes(c, rel);
      const limits = { maxEntries: EXTRACT_MAX_ENTRIES, maxTotal: EXTRACT_MAX_TOTAL, maxFile: this.uploadMaxBytes };
      precheckArchive(bytes, kind, limits);
      const dir = dirOf(rel);
      const taken = new Set((await this.listOrCreate(c, dir)).map((e) => e.name));
      const stem = checkName(archiveStem(name).trim() || 'archive');
      let folder = '';
      for (let n = 1; n <= 99 && !folder; n++) {
        const candidate = n === 1 ? stem : `${stem} (${n})`;
        if (!taken.has(candidate)) folder = join2(dir, candidate);
      }
      if (!folder) throw new WorkspaceFsError('exists', `Trop de dossiers nommés ${stem}`);
      await c.fs.mkdir(this.vol(c, folder));
      const made = new Set<string>([folder]);
      const res = await extractArchive(bytes, kind, limits, async (path, data) => {
        const target = join2(folder, path);
        const vol = this.vol(c, target);
        if (hiddenByHermes(vol)) return { path, reason: 'nom caché par Hermes' };
        const parent = dirOf(target);
        if (!made.has(parent)) {
          await c.fs.mkdir(this.vol(c, parent));
          for (let p = parent; p && p !== folder && !made.has(p); p = dirOf(p)) made.add(p);
        }
        try {
          await c.fs.create(vol, data, { overwrite: false });
        } catch (err) {
          if (err instanceof WorkspaceFsError && (err.code === 'exists' || err.code === 'invalid')) return { path, reason: err.code === 'exists' ? 'en double dans l’archive' : 'nom refusé' };
          throw err;
        }
        return 'written';
      }, () => Date.now() - started > EXTRACT_MAX_MS);
      if (res.partial) console.warn(`[files] extraction partielle de ${slug}/${rel} : ${res.count} fichiers écrits`);
      return { folder, ...res };
    } finally {
      extracting = false;
    }
  }

  /** A whole file in memory, at most uploadMaxBytes. */
  private async readBytes(c: WsCtx, rel: string): Promise<Uint8Array> {
    const { body, size } = await c.fs.read(this.vol(c, rel));
    const tooLarge = () => new ArchiveError('too_big', `Archive de plus de ${Math.round(this.uploadMaxBytes / 1024 / 1024)} Mo`);
    if (size !== null && size > this.uploadMaxBytes) {
      await body.cancel().catch(() => undefined);
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > this.uploadMaxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  /**
   * Moves a file or a folder inside the workspace, never overwriting: copy, then share links follow, then the source
   * is deleted. Hermes cannot rename: a folder is copied file by file, then deleted without `recursive`, so a file
   * Hermes does not list (keys, config) or one added or changed meanwhile stays where it was (`leftover`).
   */
  async move(slug: string, fromIn: string, toIn: string): Promise<{ path: string; leftover?: string[] }> {
    const c = this.ctx(slug);
    const from = normalizeRel(fromIn);
    const to = normalizeRel(toIn);
    if (PROTECTED.has(from)) throw new WorkspaceFsError('invalid', `${from} ne peut pas être déplacé`);
    if (PROTECTED.has(to)) throw new WorkspaceFsError('invalid', `${to} est un nom réservé à la racine du workspace`);
    if (to === from || to.startsWith(`${from}/`)) throw new WorkspaceFsError('invalid', 'Un dossier ne peut pas aller dans lui-même');
    checkName(nameOf(to));
    const src = await this.mustEntry(c, from);
    if (src.isLink) throw new WorkspaceFsError('outside', `${from} : c'est un lien symbolique ; Intendia ne le modifie pas`);
    const parent = await c.fs.entry(this.vol(c, parentOf(to)));
    if (parentOf(to) && (!parent || !parent.isDir)) throw new WorkspaceFsError('not_found', `Dossier introuvable : ${parentOf(to)}`);
    if (await c.fs.entry(this.vol(c, to))) throw new WorkspaceFsError('exists', `Existe déjà : ${to}`);
    if (src.isDir) return this.moveDir(c, from, to);
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
      throw this.leftAfterCopy(err, from, to, 'le fichier');
    }
    return { path: to };
  }

  private leftAfterCopy(err: unknown, from: string, to: string, what: string): WorkspaceFsError {
    const why = err instanceof Error ? err.message : String(err);
    return new WorkspaceFsError(err instanceof WorkspaceFsError ? err.code : 'unreachable',
      `Copié vers ${to}, mais ${from} n'a pas pu être supprimé (${why}) : ${what} est en double, les liens pointent sur la copie`);
  }

  private walkDir(c: WsCtx, root: string): Promise<WalkResult> {
    return walk(async (rel) => (await c.fs.list(this.vol(c, rel))).entries, root, {
      maxFiles: this.opts.moveMaxFiles ?? MOVE_MAX_FILES,
      maxBytes: this.opts.moveMaxBytes ?? MOVE_MAX_BYTES,
      maxFileBytes: FILE_READ_MAX,
      links: 'fail',
      tooLarge: "Dossier trop gros pour être déplacé : Hermes ne sait pas renommer, demandez-le à l'agent",
    });
  }

  private async moveDir(c: WsCtx, from: string, to: string): Promise<{ path: string; leftover?: string[] }> {
    const before = await this.walkDir(c, from);
    // copy: folders first (empty ones too), then the files one at a time; a failure drops the partial copy
    try {
      await c.fs.mkdir(this.vol(c, to));
      for (const d of before.dirs) await c.fs.mkdir(this.vol(c, under(to, d)));
      for (const f of before.files) {
        const { body } = await c.fs.read(this.vol(c, under(from, f.rel)));
        await c.fs.create(this.vol(c, under(to, f.rel)), idleGuard(body), { overwrite: false });
      }
      await this.opts.afterCopy?.();
    } catch (err) {
      await c.fs.remove(this.vol(c, to), true).catch(() => undefined);
      throw err;
    }
    // the source must be as it was walked, otherwise nothing is moved
    for (const d of ['', ...before.dirs]) c.fs.forget(this.vol(c, under(from, d)));
    let after: WalkResult | null = null;
    try {
      after = await this.walkDir(c, from);
    } catch {
      after = null;
    }
    if (!after || !sameTree(before, after)) {
      await c.fs.remove(this.vol(c, to), true).catch(() => undefined);
      throw new WorkspaceFsError('exists', `${from} a changé pendant le déplacement : rien n'a été déplacé, réessayer`);
    }
    this.links.rewritePaths(c.inst.id, this.vol(c, from), this.vol(c, to));
    // the source, never recursively: per folder, each copied file still as copied, then the folders, deepest first
    const leftover = new Set<string>();
    const byDir = new Map<string, typeof before.files>();
    for (const f of before.files) {
      const d = dirOf(f.rel);
      byDir.set(d, [...(byDir.get(d) ?? []), f]);
    }
    try {
      for (const [d, files] of byDir) {
        const dir = under(from, d);
        c.fs.forget(this.vol(c, dir));
        const now = new Map((await c.fs.list(this.vol(c, dir))).entries.map((e) => [e.name, e]));
        for (const f of files) {
          const e = now.get(nameOf(f.rel));
          if (!e || e.isLink || e.isDir || e.size !== f.size || e.mtimeMs !== f.mtimeMs) {
            leftover.add(dir);
            continue;
          }
          await c.fs.remove(this.vol(c, under(from, f.rel)), false);
        }
      }
      const dirs = ['', ...before.dirs].sort((a, b) => b.split('/').length - a.split('/').length || b.length - a.length);
      for (const d of dirs) {
        const dir = under(from, d);
        if ([...leftover].some((l) => l === dir || l.startsWith(`${dir}/`))) {
          leftover.add(dir);
          continue;
        }
        try {
          await c.fs.remove(this.vol(c, dir), false);
        } catch (err) {
          // not empty: a file Hermes does not list, or added after the check
          if (err instanceof WorkspaceFsError && err.code === 'exists') leftover.add(dir);
          else throw err;
        }
      }
    } catch (err) {
      throw this.leftAfterCopy(err, from, to, 'une partie du dossier');
    }
    // only the deepest folders are reported (their parents stay because of them)
    const kept = [...leftover].filter((l) => ![...leftover].some((o) => o !== l && o.startsWith(`${l}/`))).sort();
    return kept.length ? { path: to, leftover: kept } : { path: to };
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
