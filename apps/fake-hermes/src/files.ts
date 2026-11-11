/**
 * Managed files of the dashboard (`/api/files*`), like Hermes 0.23 with HERMES_DASHBOARD_FILES_ROOT set:
 * - every path is confined to `root` (relative paths are relative to it, ".." refused with 400);
 * - paths are resolved (symbolic links followed); an entry whose resolved path leaves the root makes the
 *   whole listing fail (403); a broken link is listed with `broken_link: true` and its unresolved path;
 * - hidden names (`.env*`, `.envrc`, `config.yaml`, `auth.json`, `credentials`, `mcp-tokens/`, `pairing/`) are
 *   never listed nor downloaded, but writes to them are allowed;
 * - upload and delete act on the target of a symbolic link (a broken one included), not on the link.
 */
import { lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, readFileSync, rmdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

export const MANAGED_FILE_MAX_BYTES = 100 * 1024 * 1024;

const SENSITIVE_FILES = new Set(['auth.json', 'auth.lock', 'credentials', 'config.yaml', '.git-credentials']);
const SENSITIVE_DIRS = new Set(['mcp-tokens', 'pairing']);

function sensitiveName(name: string): boolean {
  const n = name.toLowerCase();
  return n === '.env' || n.startsWith('.env.') || n === '.envrc' || SENSITIVE_FILES.has(n);
}

function sensitivePath(p: string): boolean {
  return sensitiveName(basename(p)) || p.split(sep).some((part) => SENSITIVE_DIRS.has(part.toLowerCase()));
}

class HttpFail extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Like Python's Path.resolve(strict=False): resolves the longest existing prefix, keeps the rest. */
function resolveLoose(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    if (parent === p) return p;
    return join(resolveLoose(parent), basename(p));
  }
}

const mime = (name: string) => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return ({ md: 'text/markdown', txt: 'text/plain', png: 'image/png', pdf: 'application/pdf', json: 'application/json', html: 'text/html' } as Record<string, string>)[ext]
    ?? 'application/octet-stream';
};

export class FilesStore {
  /** Real path of the locked root (created if missing). */
  readonly root: string;
  /** Delay before each answer, in ms (slow Hermes); tests may change it at run time. */
  delayMs = 0;

  constructor(root: string, private readonly maxBytes = MANAGED_FILE_MAX_BYTES) {
    mkdirSync(root, { recursive: true });
    this.root = realpathSync(root);
  }

  private under(p: string): boolean {
    return p === this.root || p.startsWith(this.root + sep);
  }

  private candidate(raw: string | undefined | null): string {
    const text = (raw ?? '').trim();
    if (!text || text === '.' || text === '/') return this.root;
    if (text.split('/').includes('..')) throw new HttpFail(400, "Path cannot contain '..'");
    return isAbsolute(text) ? resolve('/', text) : join(this.root, text);
  }

  /** Mirrors _resolve_managed_path: strict resolution for reads, parent resolution for writes. */
  private resolvePath(raw: string | undefined | null, forWrite = false): string {
    const cand = this.candidate(raw);
    let resolved: string;
    if (forWrite && !exists(cand)) {
      resolved = join(resolveLoose(dirname(cand)), basename(cand));
    } else if (forWrite) {
      resolved = resolveLoose(cand);
    } else {
      try {
        resolved = realpathSync(cand);
      } catch {
        throw new HttpFail(404, 'Path not found');
      }
    }
    if (!this.under(resolved)) throw new HttpFail(403, 'Path outside managed files root');
    return resolved;
  }

  private entry(target: string): Record<string, unknown> | null {
    let isLink = false;
    try {
      isLink = lstatSync(target).isSymbolicLink();
    } catch {
      return null;
    }
    const resolved = resolveLoose(target);
    if (isLink) {
      try {
        statSync(resolved);
      } catch {
        if (!this.under(join(resolveLoose(dirname(target)), basename(target)))) throw new HttpFail(403, 'Path outside managed files root');
        return { name: basename(target), path: target, is_directory: false, broken_link: true, size: null, mtime: null, mime_type: null };
      }
    }
    if (!this.under(resolved)) throw new HttpFail(403, 'Path outside managed files root');
    const st = statSync(resolved);
    const dir = st.isDirectory();
    return { name: basename(target), path: resolved, is_directory: dir, size: dir ? null : st.size, mtime: st.mtimeMs / 1000, mime_type: dir ? null : mime(resolved) };
  }

  private meta() {
    return { root: this.root, locked_root: this.root, can_change_path: false };
  }

  async handle(method: string, path: string, req: Request, query: Record<string, string>): Promise<Response | null> {
    if (path !== '/api/files' && !path.startsWith('/api/files/')) return null;
    try {
      if (method === 'GET' && path === '/api/files') return this.list(query.path);
      if (method === 'GET' && path === '/api/files/download') return this.download(query.path);
      if (method === 'POST' && path === '/api/files/upload-stream') return await this.upload(req);
      if (method === 'POST' && path === '/api/files/mkdir') return this.mkdir(((await req.json()) as { path?: string }).path);
      if (method === 'DELETE' && path === '/api/files') {
        const b = (await req.json().catch(() => ({}))) as { path?: string; recursive?: boolean };
        return this.remove(b.path, Boolean(b.recursive));
      }
      return json(404, { detail: 'Not Found' });
    } catch (err) {
      if (err instanceof HttpFail) return json(err.status, { detail: err.message });
      return json(500, { detail: (err as Error).message });
    }
  }

  private list(raw: string | undefined): Response {
    const target = this.resolvePath(raw);
    if (!statSync(target).isDirectory()) throw new HttpFail(400, 'Path is not a directory');
    const entries: Record<string, unknown>[] = [];
    for (const name of readdirSync(target)) {
      const p = join(target, name);
      if (sensitivePath(p)) continue;
      const e = this.entry(p);
      if (e) entries.push(e);
    }
    entries.sort((a, b) => Number(b.is_directory) - Number(a.is_directory) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
    const parent = target === this.root ? null : dirname(target);
    return json(200, { path: target, parent, entries, ...this.meta() });
  }

  private download(raw: string | undefined): Response {
    const target = this.resolvePath(raw);
    const st = statSync(target);
    if (!st.isFile()) throw new HttpFail(400, 'Path is not a file');
    if (sensitivePath(target)) throw new HttpFail(403, 'Access to sensitive files is not allowed');
    if (st.size > this.maxBytes) throw new HttpFail(413, 'File is too large');
    return new Response(readFileSync(target), {
      status: 200,
      headers: { 'Content-Type': mime(target), 'Content-Length': String(st.size), 'Content-Disposition': `attachment; filename="${basename(target)}"` },
    });
  }

  private async upload(req: Request): Promise<Response> {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    const path = form?.get('path');
    if (!form || !(file instanceof Blob) || typeof path !== 'string') throw new HttpFail(422, 'file and path are required');
    const overwrite = String(form.get('overwrite') ?? 'true').toLowerCase() !== 'false';
    const target = this.resolvePath(path, true);
    if (exists(target) && statSync(target).isDirectory()) throw new HttpFail(409, 'A directory already exists at that path');
    if (exists(target) && !overwrite) throw new HttpFail(409, 'File already exists');
    if (file.size > this.maxBytes) throw new HttpFail(413, 'File is too large');
    mkdirSync(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.upload`);
    writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
    renameSync(tmp, target);
    return json(200, { ok: true, entry: this.entry(target), path: target, ...this.meta() });
  }

  private mkdir(raw: string | undefined): Response {
    const target = this.resolvePath(raw, true);
    if (exists(target) && !statSync(target).isDirectory()) throw new HttpFail(409, 'A file already exists at that path');
    mkdirSync(target, { recursive: true });
    return json(200, { ok: true, entry: this.entry(target), path: target, ...this.meta() });
  }

  private remove(raw: string | undefined, recursive: boolean): Response {
    const target = this.resolvePath(raw);
    if (target === this.root) throw new HttpFail(400, 'Cannot delete the managed files root');
    const st = statSync(target);
    try {
      if (st.isDirectory()) {
        if (recursive) rmSync(target, { recursive: true });
        else rmdirSync(target);
      } else {
        unlinkSync(target);
      }
    } catch (err) {
      throw new HttpFail(st.isDirectory() && !recursive ? 409 : 500, `Could not delete path: ${(err as Error).message}`);
    }
    return json(200, { ok: true, path: target, ...this.meta() });
  }
}

function exists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
