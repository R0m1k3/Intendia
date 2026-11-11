/**
 * Share links /f/<token>: private by default (login required); the owner may make one public until a date
 * (365 days max) or revoke it. A link points to a volume path, relative to the workspace root of its instance
 * ("<slug>/…"), so a change of that root keeps links valid. Hermes stays the only source: no file list here.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import { randomToken } from '../crypto.js';
import type { Db } from '../db/index.js';
import { shareLinks, workspaces } from '../db/schema.js';
import type { InstanceStore } from '../instances/store.js';
import { mapLimit, type FileRoots, type HermesFs } from '../files/hermes-fs.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import { NotFoundError, ValidationError } from '../workspaces/service.js';

export const TOKEN_RE = /^[0-9A-Za-z]{10}$/;
export const PUBLIC_MAX_MS = 365 * 86_400_000;
export const NO_PUBLIC_URL_NOTE = "INTENDIA_PUBLIC_URL n'est pas configurée : ce lien ne marche que dans Intendia";

type Row = typeof shareLinks.$inferSelect;

export interface PublicLink {
  token: string;
  instanceId: string;
  path: string;
  /** Path as the agent sees it (<workspace root>/…). */
  agentPath: string;
  workspace: string | null;
  url: string;
  publicUntil: number | null;
  revoked: boolean;
  createdAt: number;
  exists: boolean;
}

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkError';
  }
}

export class LinkService {
  constructor(
    private readonly db: Db,
    private readonly store: InstanceStore,
    private readonly config: Pick<AppConfig, 'publicUrl'>,
    private readonly roots: FileRoots,
  ) {}

  url(token: string): string {
    return `${this.config.publicUrl ?? ''}/f/${token}`;
  }

  private instance(id: string): void {
    if (!this.store.get(id)) throw new NotFoundError(`Instance inconnue : ${id}`);
  }

  /** `<workspace root>/<volumeRel>`; the volume path alone when the instance has no root (yet). */
  agentPath(instanceId: string, volumeRel: string): string {
    try {
      return `${this.roots.root(instanceId)}/${volumeRel}`;
    } catch {
      return volumeRel;
    }
  }

  /**
   * The linked file if it still exists as a regular file (not a symbolic link), else null. Reads the listing
   * of its folder; a Hermes that does not answer raises `unreachable`.
   */
  async fileFor(row: Pick<Row, 'instanceId' | 'path'>): Promise<{ fs: HermesFs; vol: string } | null> {
    if (!this.store.get(row.instanceId)) return null;
    try {
      const fs = this.roots.fs(row.instanceId);
      const e = await fs.entry(row.path);
      return e && !e.isDir && !e.isLink ? { fs, vol: row.path } : null;
    } catch (err) {
      if (err instanceof WorkspaceFsError && err.code === 'unreachable') throw err;
      return null;
    }
  }

  /**
   * Creates a private link to a regular file (volumeRel relative to the workspace root), or reuses one.
   * forAgent: only an existing private link is reused (a public link is never handed to the agent);
   * otherwise any live link is returned as it is.
   */
  async share(instanceId: string, volumeRel: string, opts: { forAgent: boolean }): Promise<Row> {
    this.instance(instanceId);
    const e = await this.roots.fs(instanceId).entry(volumeRel);
    if (!e) throw new WorkspaceFsError('not_found', `Introuvable : ${volumeRel}`);
    if (e.isLink) throw new WorkspaceFsError('outside', `${volumeRel} : c'est un lien symbolique`);
    if (e.isDir) throw new WorkspaceFsError('not_file', `Pas un fichier : ${volumeRel}`);
    const live = this.db.select().from(shareLinks)
      .where(and(eq(shareLinks.instanceId, instanceId), eq(shareLinks.path, volumeRel), eq(shareLinks.revoked, false)))
      .orderBy(desc(shareLinks.createdAt)).all();
    const reuse = opts.forAgent ? live.find((l) => l.publicUntil === null) : live[0];
    if (reuse) return reuse;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row: Row = { token: randomToken(10), instanceId, path: volumeRel, publicUntil: null, revoked: false, createdAt: Date.now() };
      try {
        this.db.insert(shareLinks).values(row).run();
        return row;
      } catch (err) {
        if (!String((err as Error).message).includes('UNIQUE')) throw err;
      }
    }
    throw new Error('could not draw a unique token');
  }

  /** Whether each linked file still exists: one listing per instance and folder; unreadable → false. */
  async existsMany(rows: Pick<Row, 'token' | 'instanceId' | 'path'>[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>(rows.map((r) => [r.token, false]));
    const groups = new Map<string, Pick<Row, 'token' | 'instanceId' | 'path'>[]>();
    for (const r of rows) {
      const parent = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '';
      if (!parent) continue; // a workspace folder itself is never a file
      const key = `${r.instanceId}\0${parent}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const fsOf = new Map<string, HermesFs | null>();
    await mapLimit([...groups.entries()], 4, async ([key, items]) => {
      const [instanceId, parent] = key.split('\0') as [string, string];
      if (!fsOf.has(instanceId)) {
        try {
          fsOf.set(instanceId, this.store.get(instanceId) ? this.roots.fs(instanceId) : null);
        } catch {
          fsOf.set(instanceId, null);
        }
      }
      const fs = fsOf.get(instanceId);
      if (!fs) return;
      try {
        const { entries } = await fs.list(parent);
        for (const r of items) {
          const e = entries.find((x) => x.name === r.path.slice(parent.length + 1));
          out.set(r.token, Boolean(e && !e.isDir && !e.isLink));
        }
      } catch {
        // missing folder or Hermes down: false
      }
    });
    return out;
  }

  get(token: string): Row | null {
    if (!TOKEN_RE.test(token)) return null;
    return this.db.select().from(shareLinks).where(eq(shareLinks.token, token)).get() ?? null;
  }

  toPublic(row: Row, exists: boolean): PublicLink {
    const first = row.path.split('/')[0]!;
    const ws = this.db.select().from(workspaces).where(and(eq(workspaces.slug, first), eq(workspaces.instanceId, row.instanceId))).get();
    return {
      token: row.token, instanceId: row.instanceId, path: row.path,
      agentPath: this.agentPath(row.instanceId, row.path),
      workspace: ws ? ws.slug : null, url: this.url(row.token), publicUntil: row.publicUntil, revoked: row.revoked,
      createdAt: row.createdAt, exists,
    };
  }

  async list(): Promise<PublicLink[]> {
    const rows = this.db.select().from(shareLinks).orderBy(desc(shareLinks.createdAt)).all();
    const exists = await this.existsMany(rows);
    return rows.map((r) => this.toPublic(r, exists.get(r.token) ?? false));
  }

  private mustGet(token: string): Row {
    const row = this.get(token);
    if (!row) throw new NotFoundError('Lien inconnu');
    return row;
  }

  setPublic(token: string, publicUntil: number | null): Row {
    const row = this.mustGet(token);
    if (row.revoked) throw new LinkError('Lien révoqué');
    if (publicUntil !== null) {
      const now = Date.now();
      if (!Number.isFinite(publicUntil) || publicUntil <= now) throw new ValidationError("La date d'expiration doit être dans le futur");
      if (publicUntil > now + PUBLIC_MAX_MS) throw new ValidationError("L'expiration est limitée à 365 jours");
    }
    this.db.update(shareLinks).set({ publicUntil }).where(eq(shareLinks.token, token)).run();
    return { ...row, publicUntil };
  }

  revoke(token: string): void {
    this.mustGet(token);
    this.db.update(shareLinks).set({ revoked: true }).where(eq(shareLinks.token, token)).run();
  }

  /**
   * After a file was copied by a move from the explorer (before its source is deleted): links to `from`
   * or below it get the `to` prefix. Exact prefix compare, no LIKE (file names may contain % and _).
   */
  rewritePaths(instanceId: string, from: string, to: string): void {
    const n = [...from].length; // SQLite counts characters (code points), not UTF-16 units
    this.db.update(shareLinks)
      .set({ path: sql`${to} || substr(${shareLinks.path}, ${n + 1})` })
      .where(and(
        eq(shareLinks.instanceId, instanceId),
        sql`(${shareLinks.path} = ${from} OR substr(${shareLinks.path}, 1, ${n + 1}) = ${`${from}/`})`,
      )).run();
  }

  /** Volume path of a file inside a workspace. */
  static volumeRel(slug: string, rel: string): string {
    return rel ? `${slug}/${rel}` : slug;
  }
}
