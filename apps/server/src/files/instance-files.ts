/**
 * The whole file root of an instance, read only (page « Fichiers »): every workspace folder and whatever the agent
 * made beside them (crons, its own folders). Writes stay in the workspace explorer (FileService).
 */
import type { InstanceStore } from '../instances/store.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import { NotFoundError, type WorkspaceService } from '../workspaces/service.js';
import type { FileRoots } from './hermes-fs.js';
import { hiddenByHermes, normalizeRel } from './paths.js';
import { walk } from './walk.js';
import { ZIP_WALK, zipFolder, zipSlot } from './zip.js';
import { LIST_MAX, searchTree, toFileEntry, type FileEntry } from './service.js';
import { msg } from '../i18n/index.js';

export type InstanceFileEntry = FileEntry & {
  /** Top-level folder that is an Intendia workspace of this instance (its slug). */
  workspace?: string;
};

const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

export class InstanceFileService {
  constructor(
    private readonly store: InstanceStore,
    private readonly roots: FileRoots,
    private readonly workspaces: WorkspaceService,
  ) {}

  private fs(inst: string) {
    if (!this.store.get(inst)) throw new NotFoundError(msg('Instance inconnue : {id}', { id: inst }));
    return this.roots.fs(inst);
  }

  async list(inst: string, relIn: string): Promise<{ path: string; entries: InstanceFileEntry[]; truncated: boolean; agentRoot: string }> {
    const fs = this.fs(inst);
    const rel = normalizeRel(relIn, { allowRoot: true });
    const { entries: all } = await fs.listAt(rel);
    const truncated = all.length > LIST_MAX;
    const slugs = rel ? null : new Set(this.workspaces.listWorkspaces().filter((w) => w.instanceId === inst).map((w) => w.slug));
    const entries: InstanceFileEntry[] = all.slice(0, LIST_MAX)
      .map((e) => toFileEntry(e, rel))
      // credentials files: Hermes hides them too, Intendia does not count on it alone
      .filter((e) => !hiddenByHermes(e.path))
      .map((e) => (slugs && e.kind === 'dir' && slugs.has(e.name) ? { ...e, workspace: e.name } : e));
    const isDir = (e: FileEntry) => e.kind === 'dir';
    entries.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.localeCompare(b.name, 'fr'));
    return { path: rel, entries, truncated, agentRoot: fs.root };
  }

  /** A folder of the file root as a zip stream (`fichiers.zip` for the root); names hidden by Hermes left out. */
  async zip(inst: string, relIn: string): Promise<{ body: ReadableStream<Uint8Array>; name: string }> {
    const fs = this.fs(inst);
    const rel = normalizeRel(relIn, { allowRoot: true });
    if (rel && hiddenByHermes(rel)) throw new WorkspaceFsError('not_found', msg('Introuvable : {path}', { path: rel }));
    const join = (a: string, b: string) => (a && b ? `${a}/${b}` : a || b);
    const release = zipSlot();
    try {
      const tree = await walk(async (r) => (await fs.listAt(r)).entries.filter((e) => !hiddenByHermes(join(r, e.name))), rel, ZIP_WALK);
      const name = rel ? nameOf(rel) : 'fichiers';
      const body = zipFolder({ name, tree, read: async (r) => (await fs.readAt(join(rel, r))).body, onEnd: release });
      return { body, name: `${name}.zip` };
    } catch (err) {
      release();
      throw err;
    }
  }

  async search(inst: string, q: string): Promise<{ results: FileEntry[]; truncated: boolean }> {
    const fs = this.fs(inst);
    const found = await searchTree(async (rel) => (await fs.listAt(rel)).entries, q);
    return { results: found.results.filter((e) => !hiddenByHermes(e.path)), truncated: found.truncated };
  }

  async read(inst: string, relIn: string, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; size: number | null; name: string }> {
    const fs = this.fs(inst);
    const rel = normalizeRel(relIn);
    if (hiddenByHermes(rel)) throw new WorkspaceFsError('not_found', msg('Introuvable : {path}', { path: rel }));
    const { body, size } = await fs.readAt(rel, { signal });
    return { body, size, name: nameOf(rel) };
  }
}
