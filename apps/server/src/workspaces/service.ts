import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import type { InstanceConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { sessionWorkspace, workspaces } from '../db/schema.js';
import type { InstanceStore } from '../instances/store.js';
import {
  createSessionDir, createWorkspaceDir, WorkspaceFsError, framingAgentsMd, readAgentsMd, removeWorkspaceDir, writeAgentsMd,
} from './fs.js';

export type Workspace = typeof workspaces.$inferSelect;
type SessionRow = typeof sessionWorkspace.$inferSelect;

export interface PublicSession {
  id: string;
  instanceId: string;
  workspace: string;
  title: string | null;
  archived: boolean;
  lastRunId: string | null;
  lastActiveAt: number | null;
  createdAt: number;
}

export interface SessionContext {
  session: PublicSession;
  workspace: Workspace;
  instance: InstanceConfig;
  /** Hermes profile serving the workspace ("default" when none). */
  profile: string;
}

export interface RecentRun {
  instanceId: string;
  workspaceSlug: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  profile: string;
  lastActiveAt: number;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const TITLE_MAX = 60;

function toPublic(r: SessionRow): PublicSession {
  return {
    id: r.sessionId, instanceId: r.instanceId, workspace: r.workspaceSlug, title: r.title, archived: r.archived,
    lastRunId: r.lastRunId, lastActiveAt: r.lastActiveAt, createdAt: r.createdAt,
  };
}

export function newSessionId(slug: string): string {
  const n = BigInt(`0x${randomBytes(8).toString('hex')}`);
  return `iw-${slug}-${n.toString(36).padStart(12, '0').slice(-12)}`;
}

export function titleFrom(input: string): string {
  const flat = input.replace(/\s+/g, ' ').trim();
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export class WorkspaceService {
  constructor(private readonly db: Db, private readonly store: InstanceStore) {}

  private instance(id: string): InstanceConfig {
    const inst = this.store.get(id);
    if (!inst) throw new NotFoundError(`Instance inconnue : ${id}`);
    return inst;
  }

  /** Instance serving a workspace (mount, agentMount). */
  instanceOf(ws: Workspace): InstanceConfig {
    return this.instance(ws.instanceId);
  }

  dir(ws: Workspace): string {
    return join(this.instance(ws.instanceId).mount, ws.slug);
  }

  agentPath(ws: Workspace): string {
    const inst = this.instance(ws.instanceId);
    return `${(inst.agentMount ?? inst.mount).replace(/\/$/, '')}/${ws.slug}`;
  }

  // ---- workspaces

  listWorkspaces(): Workspace[] {
    return this.db.select().from(workspaces).orderBy(desc(workspaces.createdAt)).all();
  }

  getWorkspace(slug: string): Workspace {
    const ws = this.db.select().from(workspaces).where(eq(workspaces.slug, slug)).get();
    if (!ws) throw new NotFoundError(`Workspace inconnu : ${slug}`);
    return ws;
  }

  createWorkspace(input: { slug: string; name: string; instanceId: string; profile?: string | null; model?: string | null }): Workspace {
    const inst = this.instance(input.instanceId);
    const profile = input.profile && input.profile !== 'default' ? input.profile : null;
    if (profile && !inst.profileKeys[profile]) throw new ValidationError(`Profil sans clé sur cette instance : ${profile}`);
    if (this.db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get()) {
      throw new WorkspaceFsError('exists', `Le workspace ${input.slug} existe déjà`);
    }
    const dir = createWorkspaceDir(inst.mount, input.slug);
    const row: Workspace = {
      slug: input.slug, name: input.name, instanceId: inst.id, profile, model: input.model || null, createdAt: Date.now(),
    };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err) {
      removeWorkspaceDir(dir);
      throw err;
    }
    return row;
  }

  updateWorkspace(slug: string, patch: { name?: string; model?: string | null }): Workspace {
    this.getWorkspace(slug);
    const set: Partial<Workspace> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.model !== undefined) set.model = patch.model || null;
    if (Object.keys(set).length) this.db.update(workspaces).set(set).where(eq(workspaces.slug, slug)).run();
    return this.getWorkspace(slug);
  }

  readAgentsMd(slug: string): string {
    return readAgentsMd(this.dir(this.getWorkspace(slug)));
  }

  writeAgentsMd(slug: string, text: string): void {
    writeAgentsMd(this.dir(this.getWorkspace(slug)), text);
  }

  // ---- sessions

  listSessions(slug: string, opts: { archived?: boolean } = {}): PublicSession[] {
    this.getWorkspace(slug);
    return this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.workspaceSlug, slug), eq(sessionWorkspace.archived, opts.archived ?? false)))
      .all()
      .map(toPublic)
      .sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt));
  }

  /** Every session id Intendia owns on an instance (to filter "other sessions"). */
  ownedIds(instanceId: string): Set<string> {
    return new Set(this.db.select({ id: sessionWorkspace.sessionId }).from(sessionWorkspace)
      .where(eq(sessionWorkspace.instanceId, instanceId)).all().map((r) => r.id));
  }

  getSession(instanceId: string, sessionId: string): SessionContext {
    const row = this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId))).get();
    if (!row) throw new NotFoundError(`Session inconnue : ${sessionId}`);
    const workspace = this.getWorkspace(row.workspaceSlug);
    return { session: toPublic(row), workspace, instance: this.instance(instanceId), profile: workspace.profile ?? 'default' };
  }

  createSession(slug: string): PublicSession {
    const ws = this.getWorkspace(slug);
    const id = newSessionId(slug);
    createSessionDir(this.dir(ws), id);
    const now = Date.now();
    this.db.insert(sessionWorkspace).values({
      sessionId: id, instanceId: ws.instanceId, workspaceSlug: slug, title: null, archived: false, createdAt: now, lastActiveAt: now,
    }).run();
    return this.getSession(ws.instanceId, id).session;
  }

  updateSession(instanceId: string, sessionId: string, patch: { title?: string | null; archived?: boolean }): PublicSession {
    this.getSession(instanceId, sessionId);
    const set: Partial<SessionRow> = {};
    if (patch.title !== undefined) set.title = patch.title ? titleFrom(patch.title) : null;
    if (patch.archived !== undefined) set.archived = patch.archived;
    if (Object.keys(set).length) {
      this.db.update(sessionWorkspace).set(set)
        .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId))).run();
    }
    return this.getSession(instanceId, sessionId).session;
  }

  deleteSession(instanceId: string, sessionId: string): void {
    this.db.delete(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId))).run();
  }

  /** Sessions whose last run started after `sinceMs`, most recent first (Activity page). */
  /**
   * Last run of the sessions active since `sinceMs`, most recent first, `limit` at most among those `keep`
   * accepts: read by pages, so runs already known as finished do not hide older ones still going.
   */
  recentRuns(sinceMs: number, limit: number, keep: (r: RecentRun) => boolean = () => true): RecentRun[] {
    const PAGE = 100;
    const out: RecentRun[] = [];
    for (let offset = 0; out.length < limit; offset += PAGE) {
      const page = this.db.select({
        instanceId: sessionWorkspace.instanceId, workspaceSlug: sessionWorkspace.workspaceSlug, sessionId: sessionWorkspace.sessionId,
        title: sessionWorkspace.title, runId: sessionWorkspace.lastRunId, profile: workspaces.profile, workspaceName: workspaces.name,
        lastActiveAt: sessionWorkspace.lastActiveAt,
      }).from(sessionWorkspace)
        .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
        .where(and(isNotNull(sessionWorkspace.lastRunId), gte(sessionWorkspace.lastActiveAt, sinceMs)))
        .orderBy(desc(sessionWorkspace.lastActiveAt), desc(sessionWorkspace.sessionId)).limit(PAGE).offset(offset).all()
        .map((r) => ({ ...r, runId: r.runId!, profile: r.profile ?? 'default', lastActiveAt: r.lastActiveAt ?? 0 }));
      for (const r of page) if (out.length < limit && keep(r)) out.push(r);
      if (page.length < PAGE) break;
    }
    return out;
  }

  /** After createRun: last run, activity time, and the title on the first message. */
  recordRun(instanceId: string, sessionId: string, runId: string, input: string): PublicSession {
    const { session } = this.getSession(instanceId, sessionId);
    this.db.update(sessionWorkspace)
      .set({ lastRunId: runId, lastActiveAt: Date.now(), ...(session.title ? {} : { title: titleFrom(input) }) })
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId))).run();
    return this.getSession(instanceId, sessionId).session;
  }

  /** Framing lines shared by chat runs and crons; `folder` is relative to the workspace. */
  framingLines(ws: Workspace, folder: string): { workdir: string; store: string; share: string } {
    const path = this.agentPath(ws);
    return {
      workdir: `Dossier de travail : ${path}/`,
      store: `Range chaque fichier que tu produis dans ${path}/${folder}/.`,
      share: "Si l'outil share_file est disponible, appelle-le pour chaque fichier livré avec son chemin complet et donne le lien renvoyé.",
    };
  }

  /** The framing block sent in `instructions` with every run. */
  instructionsFor(ctx: SessionContext): string {
    const ws = ctx.workspace;
    const path = this.agentPath(ws);
    const agents = framingAgentsMd(readAgentsMd(this.dir(ws)), path);
    const lines = this.framingLines(ws, `sessions/${ctx.session.id}`);
    return [
      `[Intendia] Workspace : ${ws.name} (${ws.slug})`,
      lines.workdir,
      lines.store,
      lines.share,
      `Consignes du projet (${path}/AGENTS.md) :`,
      agents || '(aucune)',
    ].join('\n');
  }
}
