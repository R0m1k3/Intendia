/**
 * Share links /f/<token>: private by default (login required); the owner may make one public until a date
 * (365 days max) or revoke it. A link points to a path relative to the instance mount ("<slug>/…"), so a
 * change of agentMount or mount keeps links valid. The disk stays the only source: no file list here.
 */
import { statSync } from 'node:fs';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppConfig, InstanceConfig } from '../config.js';
import { randomToken } from '../crypto.js';
import type { Db } from '../db/index.js';
import { shareLinks, workspaces } from '../db/schema.js';
import type { InstanceStore } from '../instances/store.js';
import { resolveInside } from '../files/paths.js';
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
  /** Path as the agent sees it (agentMount/…). */
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
  constructor(private readonly db: Db, private readonly store: InstanceStore, private readonly config: Pick<AppConfig, 'publicUrl'>) {}

  url(token: string): string {
    return `${this.config.publicUrl ?? ''}/f/${token}`;
  }

  private instance(id: string): InstanceConfig {
    const inst = this.store.get(id);
    if (!inst) throw new NotFoundError(`Instance inconnue : ${id}`);
    return inst;
  }

  agentPath(inst: InstanceConfig, volumeRel: string): string {
    return `${(inst.agentMount ?? inst.mount).replace(/\/+$/, '')}/${volumeRel}`;
  }

  /** Real path of the linked file if it still exists as a regular file inside the mount, else null. */
  fileFor(row: Pick<Row, 'instanceId' | 'path'>): string | null {
    const inst = this.store.get(row.instanceId);
    if (!inst) return null;
    try {
      const real = resolveInside(inst.mount, row.path, 'existing');
      return statSync(real).isFile() ? real : null;
    } catch {
      return null;
    }
  }

  /**
   * Creates a private link to a regular file (volumeRel relative to the mount), or reuses one.
   * forAgent: only an existing private link is reused (a public link is never handed to the agent);
   * otherwise any live link is returned as it is.
   */
  share(instanceId: string, volumeRel: string, opts: { forAgent: boolean }): Row {
    const inst = this.instance(instanceId);
    const real = resolveInside(inst.mount, volumeRel, 'existing');
    if (!statSync(real).isFile()) throw new WorkspaceFsError('not_file', `Pas un fichier : ${volumeRel}`);
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

  get(token: string): Row | null {
    if (!TOKEN_RE.test(token)) return null;
    return this.db.select().from(shareLinks).where(eq(shareLinks.token, token)).get() ?? null;
  }

  toPublic(row: Row): PublicLink {
    const inst = this.store.get(row.instanceId);
    const first = row.path.split('/')[0]!;
    const ws = this.db.select().from(workspaces).where(and(eq(workspaces.slug, first), eq(workspaces.instanceId, row.instanceId))).get();
    return {
      token: row.token, instanceId: row.instanceId, path: row.path,
      agentPath: inst ? this.agentPath(inst, row.path) : row.path,
      workspace: ws ? ws.slug : null, url: this.url(row.token), publicUntil: row.publicUntil, revoked: row.revoked,
      createdAt: row.createdAt, exists: this.fileFor(row) !== null,
    };
  }

  list(): PublicLink[] {
    return this.db.select().from(shareLinks).orderBy(desc(shareLinks.createdAt)).all().map((r) => this.toPublic(r));
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
   * After a move from the explorer (call inside the same transaction as the rename): links to `from`
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
