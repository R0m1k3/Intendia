import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { and, asc, desc, eq, gte, isNotNull, ne } from 'drizzle-orm';
import type { InstanceConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { runStats, sessionWorkspace, workspaces } from '../db/schema.js';
import type { FinishFields } from '../chat/run-stats.js';
import type { InstanceStore } from '../instances/store.js';
import {
  createSessionDir, createWorkspaceDir, WorkspaceFsError, framingAgentsMd, readAgentsMd, removeWorkspaceDir, writeAgentsMd,
} from './fs.js';

export type Workspace = typeof workspaces.$inferSelect;
type SessionRow = typeof sessionWorkspace.$inferSelect;
export type RunStatRow = typeof runStats.$inferSelect;

export interface PublicSession {
  id: string;
  instanceId: string;
  workspace: string;
  title: string | null;
  archived: boolean;
  lastRunId: string | null;
  lastActiveAt: number | null;
  createdAt: number;
  /** Model and reasoning effort sent with each run; null = Hermes default ("Auto"). */
  model: string | null;
  /** Provider of `model` (picker group), sent with it; null = model sent alone. */
  modelProvider: string | null;
  effort: string | null;
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
    lastRunId: r.lastRunId, lastActiveAt: r.lastActiveAt, createdAt: r.createdAt, model: r.model, modelProvider: r.modelProvider, effort: r.effort,
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

  createWorkspace(input: { slug: string; name: string; instanceId: string; profile?: string | null }): Workspace {
    const inst = this.instance(input.instanceId);
    const profile = input.profile && input.profile !== 'default' ? input.profile : null;
    if (profile && !inst.profileKeys[profile]) throw new ValidationError(`Profil sans clé sur cette instance : ${profile}`);
    if (this.db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get()) {
      throw new WorkspaceFsError('exists', `Le workspace ${input.slug} existe déjà`);
    }
    const dir = createWorkspaceDir(inst.mount, input.slug);
    const row: Workspace = {
      slug: input.slug, name: input.name, instanceId: inst.id, profile, model: null, modelProvider: null, effort: null, createdAt: Date.now(),
    };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err) {
      removeWorkspaceDir(dir);
      throw err;
    }
    return row;
  }

  updateWorkspace(slug: string, patch: { name?: string }): Workspace {
    this.getWorkspace(slug);
    const set: Partial<Workspace> = {};
    if (patch.name !== undefined) set.name = patch.name;
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

  /** Unarchived sessions of every workspace, most recently active first (home page). */
  recentSessions(limit: number): (PublicSession & { workspaceName: string; profile: string })[] {
    return this.db.select({ s: sessionWorkspace, workspaceName: workspaces.name, profile: workspaces.profile })
      .from(sessionWorkspace)
      .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
      .where(eq(sessionWorkspace.archived, false))
      // lastActiveAt is set from creation on
      .orderBy(desc(sessionWorkspace.lastActiveAt), desc(sessionWorkspace.sessionId)).limit(limit).all()
      .map((r) => ({ ...toPublic(r.s), workspaceName: r.workspaceName, profile: r.profile ?? 'default' }));
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
      // a new session starts from the last choice made in this workspace
      model: ws.model, modelProvider: ws.modelProvider, effort: ws.effort,
    }).run();
    return this.getSession(ws.instanceId, id).session;
  }

  updateSession(
    instanceId: string, sessionId: string,
    patch: { title?: string | null; archived?: boolean; model?: string | null; provider?: string | null; effort?: string | null },
  ): PublicSession {
    const { workspace } = this.getSession(instanceId, sessionId);
    const set: Partial<SessionRow> = {};
    if (patch.title !== undefined) set.title = patch.title ? titleFrom(patch.title) : null;
    if (patch.archived !== undefined) set.archived = patch.archived;
    // the run options are also remembered as the workspace's last choice (start of its next sessions)
    const choice: Partial<Workspace> = {};
    // model and provider always change together: a model alone clears the provider
    if (patch.provider && !patch.model) throw new ValidationError('fournisseur sans modèle');
    if (patch.model !== undefined) {
      set.model = choice.model = patch.model || null;
      set.modelProvider = choice.modelProvider = (patch.model && patch.provider) || null;
    }
    if (patch.effort !== undefined) set.effort = choice.effort = patch.effort || null;
    if (Object.keys(set).length) {
      this.db.transaction((tx) => {
        tx.update(sessionWorkspace).set(set)
          .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId))).run();
        if (Object.keys(choice).length) tx.update(workspaces).set(choice).where(eq(workspaces.slug, workspace.slug)).run();
      });
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

  // ---- run consumption (run_stats)

  insertRunStat(row: Omit<RunStatRow, 'costFinal' | 'endedAt' | 'hermesSessionId' | 'servedModel' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'costUsd'>): void {
    this.db.insert(runStats).values({ ...row, costFinal: false }).onConflictDoNothing().run();
  }

  /** Rows of a session, oldest first; `running` ones included only when asked. */
  runStats(instanceId: string, sessionId: string, opts: { running?: boolean } = {}): RunStatRow[] {
    return this.db.select().from(runStats)
      .where(and(
        eq(runStats.instanceId, instanceId), eq(runStats.sessionId, sessionId),
        ...(opts.running ? [] : [ne(runStats.status, 'running')]),
      ))
      .orderBy(asc(runStats.startedAt)).all();
  }

  /** End of a run, written once: a concurrent settle that lost the race changes nothing. */
  finishRunStat(instanceId: string, runId: string, f: Partial<FinishFields> & { status: string; endedAt: number; hermesSessionId: string | null }): boolean {
    const { startedAt, ...rest } = f;
    const res = this.db.update(runStats)
      .set({ ...rest, ...(startedAt ? { startedAt } : {}) })
      .where(and(eq(runStats.instanceId, instanceId), eq(runStats.runId, runId), eq(runStats.status, 'running'))).run();
    return res.changes > 0;
  }

  /** Cost of a finished run, while it is not final yet; `final` freezes it. */
  setRunCost(instanceId: string, runId: string, costUsd: number | null, final: boolean): void {
    this.db.update(runStats).set({ costUsd, costFinal: final })
      .where(and(eq(runStats.instanceId, instanceId), eq(runStats.runId, runId), eq(runStats.costFinal, false))).run();
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
