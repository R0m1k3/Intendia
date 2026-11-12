/**
 * Full walk of a folder (moving a folder, zipping it): every sub-folder and file, bounded, failing on the first
 * problem instead of skipping it (a move or a zip must not silently miss a part). `searchTree` has its own walk.
 */
import { WorkspaceFsError } from '../workspaces/fs.js';
import { mapLimit, type FsEntry } from './hermes-fs.js';

export const MOVE_MAX_FILES = 500;
export const MOVE_MAX_BYTES = 200 * 1024 * 1024;
/** Hermes reads at most 100 MiB per file. */
export const FILE_READ_MAX = 100 * 1024 * 1024;
export const IDLE_MS = 30_000;
const PARALLEL = 4;

export interface WalkOpts {
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  /** A symbolic link inside: `fail` → 403 `outside`, `skip` → left out. */
  links: 'fail' | 'skip';
  /** Message of the `too_large` error. */
  tooLarge?: string;
}

export interface WalkFile { rel: string; size: number; mtimeMs: number }
export interface WalkResult { dirs: string[]; files: WalkFile[] }

const join2 = (a: string, b: string) => (a && b ? `${a}/${b}` : a || b);

/**
 * Walks `root` breadth first; `list(rel)` gives the entries of a folder (`rel` relative to the place the caller
 * lists from, `root` included). Paths in the result are relative to `root`; `dirs` lists every sub-folder (empty
 * ones too), parents before children. Throws as soon as a limit is passed (nothing more is listed).
 */
export async function walk(list: (rel: string) => Promise<FsEntry[]>, root: string, opts: WalkOpts): Promise<WalkResult> {
  const dirs: string[] = [];
  const files: WalkFile[] = [];
  let bytes = 0;
  let failed: unknown = null;
  const tooLarge = () => new WorkspaceFsError('too_large', opts.tooLarge ?? 'Dossier trop gros');
  let level = [''];
  while (level.length && !failed) {
    const next: string[] = [];
    await mapLimit(level, PARALLEL, async (sub) => {
      if (failed) return;
      let entries: FsEntry[];
      try {
        entries = await list(join2(root, sub));
      } catch (err) {
        failed ??= err;
        return;
      }
      for (const e of entries) {
        if (failed) return;
        const rel = join2(sub, e.name);
        if (e.isLink) {
          if (opts.links === 'fail') failed = new WorkspaceFsError('outside', `${join2(root, rel)} : c'est un lien symbolique ; Intendia ne le déplace pas`);
          continue;
        }
        if (e.isDir) {
          dirs.push(rel);
          next.push(rel);
          continue;
        }
        bytes += e.size;
        if (files.length + 1 > opts.maxFiles || bytes > opts.maxBytes || e.size > opts.maxFileBytes) {
          failed = tooLarge();
          return;
        }
        files.push({ rel, size: e.size, mtimeMs: e.mtimeMs });
      }
    });
    level = next;
  }
  if (failed) throw failed;
  return { dirs, files };
}

/** The same stream, cut with 502 `unreachable` when no byte arrives for `ms`. */
export function idleGuard(source: ReadableStream<Uint8Array>, ms = IDLE_MS): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      let timer: NodeJS.Timeout | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WorkspaceFsError('unreachable', 'Hermes ne répond plus pendant la lecture du fichier')), ms);
      });
      try {
        const { done, value } = await Promise.race([reader.read(), idle]);
        if (done) c.close();
        else c.enqueue(value);
      } catch (err) {
        void reader.cancel().catch(() => undefined);
        c.error(err);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) { return reader.cancel(reason).catch(() => undefined); },
  });
}
