/**
 * A folder sent as a zip, built while it is sent (fflate `Zip`): files read one at a time from Hermes, memory stays
 * flat. A file too big or that cannot be read is left out and listed in `_erreurs.txt` at the end: the zip stays
 * valid. At most ZIP_PARALLEL zips at a time on the server.
 */
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { WorkspaceFsError } from '../workspaces/fs.js';
import { FILE_READ_MAX, idleGuard, type WalkOpts, type WalkResult } from './walk.js';

export const ZIP_PARALLEL = 2;
export const ZIP_WALK: WalkOpts = {
  maxFiles: 5000,
  maxBytes: 1024 * 1024 * 1024,
  maxFileBytes: Infinity, // a file past FILE_READ_MAX is left out and listed, not a failure
  links: 'skip',
  tooLarge: 'Dossier trop gros pour un zip (5 000 fichiers ou 1 Gio au plus)',
};
/** Already compressed: stored as they are. */
const COMPRESSED = /\.(png|jpe?g|gif|webp|avif|heic|mp4|webm|mov|mkv|mp3|m4a|ogg|opus|flac|aac|zip|gz|tgz|bz2|xz|7z|rar|zst|docx|xlsx|pptx|odt|ods|odp|epub|pdf|woff2?)$/i;

const DATE_MIN = Date.UTC(1980, 0, 2);
const DATE_MAX = Date.UTC(2099, 0, 1);

let running = 0;

/** A place among the zips running; throws 409 `busy` when all are taken. The release runs once. */
export function zipSlot(): () => void {
  if (running >= ZIP_PARALLEL) throw new WorkspaceFsError('busy', 'Deux zips sont déjà en cours, réessayez dans un instant');
  running++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    running--;
  };
}

export function zipFolder(opts: {
  /** Folder name at the top of the zip. */
  name: string;
  tree: WalkResult;
  read: (rel: string) => Promise<ReadableStream<Uint8Array>>;
  /** Called once: end, error or the client went away. */
  onEnd?: () => void;
  idleMs?: number;
}): ReadableStream<Uint8Array> {
  const { name, tree, read } = opts;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    opts.onEnd?.();
  };
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  let wake: (() => void) | null = null;
  // back pressure: wait for the reader before pushing more
  const room = () => (cancelled || (ctrl.desiredSize ?? 1) > 0 ? Promise.resolve() : new Promise<void>((r) => { wake = r; }));
  const zip = new Zip((err, data, final) => {
    if (cancelled) return;
    if (err) {
      ctrl.error(err);
      end();
      return;
    }
    ctrl.enqueue(data);
    if (final) {
      ctrl.close();
      end();
    }
  });
  const stored = (path: string, data: Uint8Array) => {
    const e = new ZipPassThrough(path);
    zip.add(e);
    e.push(data, true);
  };

  const run = async () => {
    for (const d of tree.dirs) stored(`${name}/${d}/`, new Uint8Array(0));
    const errors: string[] = [];
    for (const f of tree.files) {
      if (cancelled) return;
      if (f.size > FILE_READ_MAX) {
        errors.push(`${f.rel} : plus de 100 Mio, Hermes ne le lit pas`);
        continue;
      }
      let body: ReadableStream<Uint8Array>;
      try {
        body = idleGuard(await read(f.rel), opts.idleMs);
      } catch (err) {
        errors.push(`${f.rel} : ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const path = `${name}/${f.rel}`;
      const entry = COMPRESSED.test(f.rel) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 1 });
      // zip dates go from 1980 to 2099 (fflate throws outside): other dates keep the default (now)
      if (f.mtimeMs >= DATE_MIN && f.mtimeMs < DATE_MAX) entry.mtime = f.mtimeMs;
      zip.add(entry);
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          entry.push(value);
          await room();
          if (cancelled) {
            void reader.cancel().catch(() => undefined);
            return;
          }
        }
        entry.push(new Uint8Array(0), true);
      } catch (err) {
        entry.push(new Uint8Array(0), true);
        errors.push(`${f.rel} : lecture interrompue, fichier incomplet dans le zip (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    if (errors.length) stored(`${name}/_erreurs.txt`, strToU8(`${errors.join('\n')}\n`));
    zip.end();
  };

  return new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      run().catch((err: unknown) => {
        if (!cancelled) ctrl.error(err);
        end();
      });
    },
    pull() {
      const w = wake;
      wake = null;
      w?.();
    },
    cancel() {
      cancelled = true;
      const w = wake;
      wake = null;
      w?.();
      zip.terminate();
      end();
    },
  });
}
