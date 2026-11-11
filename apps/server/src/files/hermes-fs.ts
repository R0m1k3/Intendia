/**
 * Workspace files of one instance, through the managed files API of its dashboard (connector `files`).
 * Every path is a volume path, relative to the instance's workspace root (`<slug>/files/a.txt`); Hermes
 * confines everything to that root. One check on top: Hermes writes and deletes the *target* of a symbolic
 * link, so creating, overwriting or deleting an entry that is a link is refused (403 `outside`).
 * One HermesFs per service call: its cache of folder listings lives for that call only.
 */
import { randomBytes } from 'node:crypto';
import type { CompatService } from '../compat/service.js';
import type { HermesFilesList } from '../connectors/files/index.js';
import { callOp, hermesDetail, HermesError, ModuleUnavailableError, streamOp, type HermesHttp } from '../connectors/runtime.js';
import type { CompatReport } from '../connectors/types.js';
import { SLUG_RE, WorkspaceFsError } from '../workspaces/fs.js';
import { hiddenByHermes, normalizeRel } from './paths.js';

export interface FsEntry {
  name: string;
  /** Volume path. */
  vol: string;
  isDir: boolean;
  /** Symbolic link (broken or not): never written, deleted nor moved by Intendia. */
  isLink: boolean;
  /** Broken symbolic link (its target does not exist). */
  broken: boolean;
  size: number;
  mtimeMs: number;
}

export const UPLOAD_TIMEOUT_MS = 600_000;
const LINK_REFUSED = "c'est un lien symbolique ; Intendia ne le modifie pas";
const LINK_OUT_OF_ROOT = "un lien symbolique de ce dossier sort de la racine d'Hermes ; demandez à l'agent de le supprimer";

const parentOf = (vol: string) => (vol.includes('/') ? vol.slice(0, vol.lastIndexOf('/')) : '');
const nameOf = (vol: string) => vol.slice(vol.lastIndexOf('/') + 1);

/** Runs `fn` on every item, at most `n` at a time. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Hermes (or network) failure → WorkspaceFsError with a message for the owner. */
export function fsError(err: unknown, vol: string, what: 'list' | 'other' = 'other'): Error {
  if (err instanceof WorkspaceFsError) return err;
  if (err instanceof ModuleUnavailableError) return new WorkspaceFsError('no_root', `Fichiers indisponibles sur cette instance : ${err.reasons.at(-1) ?? err.message}`);
  if (err instanceof HermesError) {
    if (err.kind !== 'http') {
      return new WorkspaceFsError('unreachable', err.kind === 'unconfigured' ? `Fichiers indisponibles : ${err.message}` : 'Hermes injoignable');
    }
    const status = err.detail.status ?? 0;
    const detail = hermesDetail(err);
    if (status === 400) return new WorkspaceFsError('invalid', `Chemin refusé par Hermes : ${vol || '/'} (${detail})`);
    if (status === 403) return new WorkspaceFsError('outside', what === 'list' ? `${vol || '/'} : ${LINK_OUT_OF_ROOT}` : `Refusé par Hermes : ${vol || '/'} (${detail})`);
    if (status === 404) return new WorkspaceFsError('not_found', `Introuvable : ${vol || '/'}`);
    if (status === 409) return new WorkspaceFsError('exists', `Existe déjà chez Hermes : ${vol}`);
    if (status === 413) return new WorkspaceFsError('too_large', 'Fichier trop gros pour Hermes (100 Mo au plus)');
    return new WorkspaceFsError('unreachable', `Hermes a répondu HTTP ${status}`);
  }
  return err as Error;
}

/** Resolves the workspace root of each instance from its last compatibility report. */
export class FileRoots {
  constructor(private readonly compat: CompatService, private readonly opts: { uploadTimeoutMs?: number } = {}) {}

  /** `<workspaceRoot>` of the instance, or `no_root` with the reason. */
  root(instanceId: string): string {
    const files = this.compat.get(instanceId)?.files;
    if (!files) throw new WorkspaceFsError('no_root', 'Fichiers pas encore vérifiés sur cette instance : cliquez « Revérifier » dans Réglages');
    if (!files.workspaceRoot) throw new WorkspaceFsError('no_root', files.reason ?? 'Fichiers indisponibles sur cette instance');
    return files.workspaceRoot;
  }

  fs(instanceId: string): HermesFs {
    const root = this.root(instanceId);
    return new HermesFs(this.compat.http(instanceId), this.compat.get(instanceId), root, this.opts.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS);
  }
}

export class HermesFs {
  private readonly lists = new Map<string, Promise<{ entries: FsEntry[] }>>();

  constructor(
    private readonly http: HermesHttp,
    private readonly report: CompatReport | undefined,
    readonly root: string,
    private readonly uploadTimeoutMs = UPLOAD_TIMEOUT_MS,
  ) {}

  /** Absolute path on the Hermes side; `vol` must start with a workspace slug. */
  private abs(vol: string): string {
    const v = normalizeRel(vol);
    if (!SLUG_RE.test(v.split('/')[0]!)) throw new WorkspaceFsError('invalid', `Chemin invalide : ${vol}`);
    return `${this.root}/${v}`;
  }

  private async fetchList(path: string, dirVol: string): Promise<{ entries: FsEntry[] }> {
    let list: HermesFilesList;
    try {
      list = await callOp<HermesFilesList>(this.http, this.report, 'files', 'list', { query: { path } });
    } catch (err) {
      throw fsError(err, dirVol, 'list');
    }
    const base = list.path.replace(/\/+$/, '');
    return {
      entries: list.entries.map((e) => ({
        name: e.name,
        vol: dirVol ? `${dirVol}/${e.name}` : e.name,
        isDir: e.is_directory && !e.broken_link,
        // the listing itself may have been reached through a link: compare with its own resolved path
        isLink: e.broken_link === true || e.path !== `${base}/${e.name}`,
        broken: e.broken_link === true,
        size: e.size ?? 0,
        mtimeMs: e.mtime ? Math.floor(e.mtime * 1000) : 0,
      })),
    };
  }

  /** Entries of a folder (cached for the life of this object, emptied by writes). */
  list(vol: string): Promise<{ entries: FsEntry[] }> {
    const abs = this.abs(vol);
    const key = normalizeRel(vol);
    let p = this.lists.get(key);
    if (!p) {
      p = this.fetchList(abs, key);
      this.lists.set(key, p);
      p.catch(() => this.lists.delete(key));
    }
    return p;
  }

  /** The workspace root itself (folders to adopt). */
  listRoot(): Promise<{ entries: FsEntry[] }> {
    let p = this.lists.get('');
    if (!p) {
      p = this.fetchList(this.root, '');
      this.lists.set('', p);
      p.catch(() => this.lists.delete(''));
    }
    return p;
  }

  /** An entry as listed in its parent; null when it or its parent does not exist. */
  async entry(vol: string): Promise<FsEntry | null> {
    const v = normalizeRel(vol);
    const parent = parentOf(v);
    try {
      const { entries } = parent ? await this.list(parent) : await this.listRoot();
      return entries.find((e) => e.name === nameOf(v)) ?? null;
    } catch (err) {
      if (err instanceof WorkspaceFsError && err.code === 'not_found') return null;
      throw err;
    }
  }

  /** Drops the cached listings of a folder, its ancestors and its descendants. */
  forget(dirVol: string): void {
    for (const key of [...this.lists.keys()]) {
      if (key === '' || key === dirVol || dirVol.startsWith(`${key}/`) || key.startsWith(`${dirVol}/`)) this.lists.delete(key);
    }
  }

  private refuseHidden(vol: string): void {
    if (hiddenByHermes(normalizeRel(vol))) {
      throw new WorkspaceFsError('invalid', `${nameOf(normalizeRel(vol))} : Hermes cache ce nom (fichier d'identifiants), Intendia ne l'écrit pas`);
    }
  }

  private async refuseLink(vol: string): Promise<FsEntry | null> {
    const e = await this.entry(vol);
    if (e?.isLink) throw new WorkspaceFsError('outside', `${vol} : ${LINK_REFUSED}`);
    return e;
  }

  /** A regular file as a stream (no partial requests). */
  async read(vol: string, opts: { signal?: AbortSignal } = {}): Promise<{ body: ReadableStream<Uint8Array>; size: number | null; mime: string | null }> {
    const path = this.abs(vol);
    let res: Response;
    try {
      res = await streamOp(this.http, this.report, 'files', 'download', { query: { path }, signal: opts.signal, timeoutMs: 30_000 });
    } catch (err) {
      throw fsError(err, vol);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 400) throw new WorkspaceFsError('not_file', `Pas un fichier : ${vol}`);
      throw fsError(new HermesError('http', `dash GET download: HTTP ${res.status}`, { status: res.status, body: body.slice(0, 500) }), vol);
    }
    const len = Number(res.headers.get('content-length'));
    return { body: res.body ?? new ReadableStream({ start: (c) => c.close() }), size: Number.isFinite(len) && res.headers.has('content-length') ? len : null, mime: res.headers.get('content-type') };
  }

  /** A small text file, at most `max` bytes. */
  async readText(vol: string, max: number): Promise<string> {
    const { body } = await this.read(vol);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        throw new WorkspaceFsError('too_large', `${vol} dépasse ${Math.round(max / 1024)} Kio`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /**
   * Writes a file (multipart upload-stream, built as a stream). Refused when the entry is a symbolic link.
   * `maxBytes`: the body is cut and `too_large` raised beyond it. Returns the entry read back.
   */
  async create(
    vol: string,
    content: string | Uint8Array | ReadableStream<Uint8Array> | null,
    opts: { overwrite: boolean; maxBytes?: number; signal?: AbortSignal },
  ): Promise<FsEntry> {
    const path = this.abs(vol);
    this.refuseHidden(vol);
    await this.refuseLink(vol);
    const boundary = `----intendia${randomBytes(12).toString('hex')}`;
    const enc = new TextEncoder();
    const field = (name: string, value: string) => enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    const head = new Uint8Array(Buffer.concat([
      field('path', path),
      field('overwrite', opts.overwrite ? 'true' : 'false'),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    ]));
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const source: ReadableStream<Uint8Array> = content instanceof ReadableStream
      ? content
      : new ReadableStream({ start(c) { if (content !== null) c.enqueue(typeof content === 'string' ? enc.encode(content) : content); c.close(); } });
    const max = opts.maxBytes ?? Infinity;
    const abort = new AbortController();
    opts.signal?.addEventListener('abort', () => abort.abort(opts.signal?.reason), { once: true });
    let tooLarge = false;
    let size = 0;
    const reader = source.getReader();
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(head); },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) {
          c.enqueue(tail);
          c.close();
          return;
        }
        size += value.length;
        if (size > max) {
          tooLarge = true;
          await reader.cancel().catch(() => undefined);
          abort.abort(new Error('too large'));
          c.error(new WorkspaceFsError('too_large', 'Fichier trop gros'));
          return;
        }
        c.enqueue(value);
      },
      cancel() { void reader.cancel().catch(() => undefined); },
    });
    const tooBig = () => new WorkspaceFsError('too_large', `Fichier trop gros (${Math.round(max / 1048576)} Mo au plus)`);
    let res: Response;
    try {
      res = await streamOp(this.http, this.report, 'files', 'upload', {
        rawBody: body, contentType: `multipart/form-data; boundary=${boundary}`, signal: abort.signal, timeoutMs: this.uploadTimeoutMs,
      });
    } catch (err) {
      if (tooLarge) throw tooBig();
      throw fsError(err, vol);
    } finally {
      this.forget(parentOf(normalizeRel(vol)));
    }
    if (tooLarge) throw tooBig();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw fsError(new HermesError('http', `dash POST upload-stream: HTTP ${res.status}`, { status: res.status, body: text.slice(0, 500) }), vol);
    }
    await res.body?.cancel().catch(() => undefined);
    const e = await this.entry(vol);
    if (!e) throw new WorkspaceFsError('not_found', `Introuvable après l'envoi : ${vol}`);
    return e;
  }

  /** Creates a folder and its parents (idempotent). */
  async mkdir(vol: string): Promise<void> {
    const path = this.abs(vol);
    this.refuseHidden(vol);
    try {
      await callOp(this.http, this.report, 'files', 'mkdir', { body: { path } });
    } catch (err) {
      throw fsError(err, vol);
    } finally {
      this.forget(normalizeRel(vol));
    }
  }

  /** Deletes a file or a folder (always recursive for a folder). Refused for a symbolic link. */
  async remove(vol: string, recursive = true): Promise<void> {
    const path = this.abs(vol);
    await this.refuseLink(vol);
    try {
      await callOp(this.http, this.report, 'files', 'remove', { body: { path, recursive } });
    } catch (err) {
      throw fsError(err, vol);
    } finally {
      this.forget(normalizeRel(vol));
    }
  }
}
