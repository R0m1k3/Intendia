import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, notLike, or, sql } from 'drizzle-orm';
import type { InstanceConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { runStats, sessionWorkspace, workspaces } from '../db/schema.js';
import { moveGoalStatement } from '../chat/goal.js';
import type { FinishFields } from '../chat/run-stats.js';
import type { InstanceStore } from '../instances/store.js';
import type { FileRoots } from '../files/hermes-fs.js';
import { createSessionDir, createWorkspaceDir, WorkspaceFsError, framingAgentsMd, readAgentsMd, writeAgentsMd } from './fs.js';

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
  pinned: boolean;
  /** Copy of another Hermes session (its id) or "import:<key>": exists at Hermes even without a run from Intendia. */
  copiedFrom: string | null;
  /** The session this one replaced (edit, retry, undo, clear), restorable during its undo window. */
  replacesId: string | null;
  /** 'hermes:<name>' or 'intendia:<prompt id>', added to the instructions of each run; null = none. */
  personality: string | null;
  /** « Sans confirmation »: Intendia answers the approvals of its runs. */
  autoApprove: boolean;
  /** Hermes profile chosen for this session; null = the workspace's default profile (see SessionContext.profile). */
  profile: string | null;
}

/** Undo window of a deletion: the session stays at Hermes and can be restored until it is over. */
export const UNDO_MS = 10_000;
/** A never used Intendia session (no run, not a copy) older than this is offered to the clean-up. */
export const UNUSED_AFTER_MS = 60 * 60 * 1000;
/** A row taken by the purger is tried again after this delay (failure, or a stop during the attempt). */
export const PURGE_RETRY_MS = 60_000;

/** A deleted session the purger took: delete it at Hermes, then drop its row. */
export interface PurgeItem {
  instanceId: string;
  sessionId: string;
  profile: string;
}

export interface SessionContext {
  session: PublicSession;
  workspace: Workspace;
  instance: InstanceConfig;
  /** Hermes profile serving the session: its own, else the workspace's default ("default" when none). */
  profile: string;
}

/** A run launched from Intendia that ended recently (Centre, « Terminé »). */
export interface FinishedRun {
  instance: string;
  workspace: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  status: string;
  startedAt: number;
  endedAt: number;
  costUsd: number | null;
}

const FINISHED_WINDOW_MS = 24 * 3600_000;
const FINISHED_LIMIT = 50;

export interface RecentRun {
  instanceId: string;
  workspaceSlug: string;
  workspaceName: string;
  sessionId: string;
  title: string | null;
  runId: string;
  profile: string;
  lastActiveAt: number;
  autoApprove: boolean;
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

export const TITLE_MAX = 60;

/** Profile of a session in a query joined with its workspace: its own, else the workspace's default (NULL = "default"). */
const sessionProfile = sql<string | null>`coalesce(${sessionWorkspace.profile}, ${workspaces.profile})`;

function toPublic(r: SessionRow): PublicSession {
  return {
    id: r.sessionId, instanceId: r.instanceId, workspace: r.workspaceSlug, title: r.title, archived: r.archived,
    lastRunId: r.lastRunId, lastActiveAt: r.lastActiveAt, createdAt: r.createdAt, model: r.model, modelProvider: r.modelProvider, effort: r.effort,
    pinned: r.pinned, copiedFrom: r.copiedFrom, replacesId: r.replacesId, personality: r.personality, autoApprove: r.autoApprove,
    profile: r.profile,
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

/** Rows not deleted (deletion pending undo, or taken by the purger). */
const alive = isNull(sessionWorkspace.deletedAt);

export class WorkspaceService {
  /** Last AGENTS.md read per workspace: the chat keeps its instructions while Hermes' dashboard is down. */
  private readonly agentsMd = new Map<string, string>();
  /** Slugs being created: a second request for the same slug gets "exists" instead of racing the first. */
  private readonly creating = new Set<string>();

  constructor(private readonly db: Db, private readonly store: InstanceStore, private readonly roots: FileRoots) {}

  private instance(id: string): InstanceConfig {
    const inst = this.store.get(id);
    if (!inst) throw new NotFoundError(`Instance inconnue : ${id}`);
    return inst;
  }

  /** Instance serving a workspace. */
  instanceOf(ws: Workspace): InstanceConfig {
    return this.instance(ws.instanceId);
  }

  /** `<workspace root>/<slug>`, the folder as the agent (and Hermes' dashboard) sees it; `no_root` without root. */
  agentPath(ws: Workspace): string {
    this.instance(ws.instanceId);
    return `${this.roots.root(ws.instanceId)}/${ws.slug}`;
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

  async createWorkspace(input: { slug: string; name: string; instanceId: string; profile?: string | null }): Promise<Workspace> {
    const inst = this.instance(input.instanceId);
    const profile = input.profile && input.profile !== 'default' ? input.profile : null;
    if (profile && !inst.profileKeys[profile]) throw new ValidationError(`Profil sans clé sur cette instance : ${profile}`);
    if (this.creating.has(input.slug) || this.db.select().from(workspaces).where(eq(workspaces.slug, input.slug)).get()) {
      throw new WorkspaceFsError('exists', `Le workspace ${input.slug} existe déjà`);
    }
    this.creating.add(input.slug);
    try {
      return await this.createWorkspaceRow(inst, profile, input);
    } finally {
      this.creating.delete(input.slug);
    }
  }

  private async createWorkspaceRow(inst: InstanceConfig, profile: string | null, input: { slug: string; name: string }): Promise<Workspace> {
    const fs = this.roots.fs(inst.id);
    await createWorkspaceDir(fs, input.slug);
    const row: Workspace = {
      slug: input.slug, name: input.name, instanceId: inst.id, profile, model: null, modelProvider: null, effort: null, createdAt: Date.now(),
    };
    try {
      this.db.insert(workspaces).values(row).run();
    } catch (err) {
      await fs.remove(input.slug, true).catch(() => undefined);
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

  async readAgentsMd(slug: string): Promise<string> {
    const ws = this.getWorkspace(slug);
    const text = await readAgentsMd(this.roots.fs(ws.instanceId), slug);
    this.agentsMd.set(slug, text);
    return text;
  }

  async writeAgentsMd(slug: string, text: string): Promise<void> {
    const ws = this.getWorkspace(slug);
    await writeAgentsMd(this.roots.fs(ws.instanceId), slug, text);
    this.agentsMd.set(slug, text);
  }

  // ---- sessions

  listSessions(slug: string, opts: { archived?: boolean } = {}): PublicSession[] {
    this.getWorkspace(slug);
    return this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.workspaceSlug, slug), eq(sessionWorkspace.archived, opts.archived ?? false), alive))
      .all()
      .map(toPublic)
      // pinned first, then most recently active
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt));
  }

  /** Unarchived sessions of the instance's workspaces, most recently active first (home page). */
  /** What uses a Hermes profile on an instance: workspaces whose default it is, sessions that chose it. */
  usesProfile(instanceId: string, profile: string): { workspaces: string[]; sessions: number } {
    const ws = this.db.select({ slug: workspaces.slug }).from(workspaces)
      .where(and(eq(workspaces.instanceId, instanceId), eq(workspaces.profile, profile))).all().map((r) => r.slug);
    const n = this.db.select({ n: count() }).from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.profile, profile))).get()?.n ?? 0;
    return { workspaces: ws, sessions: n };
  }

  recentSessions(limit: number, instanceId: string): (PublicSession & { workspaceName: string; profile: string })[] {
    return this.db.select({ s: sessionWorkspace, workspaceName: workspaces.name, profile: sessionProfile })
      .from(sessionWorkspace)
      .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
      .where(and(eq(sessionWorkspace.archived, false), eq(workspaces.instanceId, instanceId), alive))
      // lastActiveAt is set from creation on
      .orderBy(desc(sessionWorkspace.lastActiveAt), desc(sessionWorkspace.sessionId)).limit(limit).all()
      .map((r) => ({ ...toPublic(r.s), workspaceName: r.workspaceName, profile: r.profile ?? 'default' }));
  }

  /** Non-archived Intendia sessions whose title contains `q`, case-insensitive with Unicode folding (SQLite's `lower()` only folds ASCII). */
  searchSessions(q: string, limit: number, instanceId: string): (PublicSession & { workspaceName: string; profile: string })[] {
    const needle = q.toLocaleLowerCase();
    return this.db.select({ s: sessionWorkspace, workspaceName: workspaces.name, profile: sessionProfile })
      .from(sessionWorkspace)
      .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
      .where(and(eq(sessionWorkspace.archived, false), eq(workspaces.instanceId, instanceId), alive))
      .orderBy(desc(sessionWorkspace.lastActiveAt), desc(sessionWorkspace.sessionId)).all()
      .filter((r) => r.s.title?.toLocaleLowerCase().includes(needle))
      .slice(0, limit)
      .map((r) => ({ ...toPublic(r.s), workspaceName: r.workspaceName, profile: r.profile ?? 'default' }));
  }

  /** Non-archived Intendia sessions of an instance among `ids` (same fields as `recentSessions`). */
  sessionsByIds(instanceId: string, ids: string[]): (PublicSession & { workspaceName: string; profile: string })[] {
    if (ids.length === 0) return [];
    return this.db.select({ s: sessionWorkspace, workspaceName: workspaces.name, profile: sessionProfile })
      .from(sessionWorkspace)
      .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.archived, false), inArray(sessionWorkspace.sessionId, ids), alive))
      .all()
      .map((r) => ({ ...toPublic(r.s), workspaceName: r.workspaceName, profile: r.profile ?? 'default' }));
  }

  /** Non-archived sessions per workspace slug. */
  sessionCounts(): Map<string, number> {
    const rows = this.db.select({ slug: sessionWorkspace.workspaceSlug, n: count() }).from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.archived, false), alive)).groupBy(sessionWorkspace.workspaceSlug).all();
    return new Map(rows.map((r) => [r.slug, r.n]));
  }

  /** Every session id Intendia owns on an instance (to filter "other sessions"), deleted ones included. */
  ownedIds(instanceId: string): Set<string> {
    return new Set(this.db.select({ id: sessionWorkspace.sessionId }).from(sessionWorkspace)
      .where(eq(sessionWorkspace.instanceId, instanceId)).all().map((r) => r.id));
  }

  getSession(instanceId: string, sessionId: string): SessionContext {
    const row = this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId), alive)).get();
    if (!row) throw new NotFoundError(`Session inconnue : ${sessionId}`);
    const workspace = this.getWorkspace(row.workspaceSlug);
    return { session: toPublic(row), workspace, instance: this.instance(instanceId), profile: row.profile ?? workspace.profile ?? 'default' };
  }

  async createSession(slug: string): Promise<PublicSession> {
    const ws = this.getWorkspace(slug);
    const id = newSessionId(slug);
    // one attempt; without it the agent creates the folder when it writes there
    try {
      await createSessionDir(this.roots.fs(ws.instanceId), slug, id);
    } catch (err) {
      console.warn(`[intendia] session folder ${slug}/sessions/${id} not created: ${(err as Error).message}`);
    }
    const now = Date.now();
    this.db.insert(sessionWorkspace).values({
      sessionId: id, instanceId: ws.instanceId, workspaceSlug: slug, title: null, archived: false, createdAt: now, lastActiveAt: now,
      // a new session starts from the last choice made in this workspace
      model: ws.model, modelProvider: ws.modelProvider, effort: ws.effort,
    }).run();
    return this.getSession(ws.instanceId, id).session;
  }

  /** The live row of `id` in workspace `slug`, if any (a copy action retried with the same key). */
  existingCopy(slug: string, id: string): PublicSession | null {
    const row = this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.workspaceSlug, slug), eq(sessionWorkspace.sessionId, id), alive)).get();
    return row ? toPublic(row) : null;
  }

  /** The row of `id` on the instance, alive or deleted (null once dropped by the purger). */
  rowOf(instanceId: string, id: string): SessionRow | null {
    return this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, id))).get() ?? null;
  }

  /**
   * Rows of a truncated copy, in one transaction: the new session (its options from the original), the cost lines
   * of the replies it keeps (`run_id@newId`, frozen), and with `replaces` the original hidden with the undo window.
   */
  async replaceRows(o: {
    slug: string; instanceId: string; newId: string; from: PublicSession; title: string | null; copiedFrom: string | null;
    replaces: boolean; keepRunsBefore: number | null | 'all'; now?: number;
  }): Promise<{ session: PublicSession; undoUntil: number | null }> {
    try {
      await createSessionDir(this.roots.fs(o.instanceId), o.slug, o.newId);
    } catch (err) {
      console.warn(`[intendia] session folder ${o.slug}/sessions/${o.newId} not created: ${(err as Error).message}`);
    }
    const now = o.now ?? Date.now();
    const f = o.from;
    const runs = o.keepRunsBefore === null ? [] : this.runStats(o.instanceId, f.id)
      .filter((r) => r.endedAt !== null && (o.keepRunsBefore === 'all' || r.endedAt < (o.keepRunsBefore as number)));
    this.db.transaction((tx) => {
      tx.insert(sessionWorkspace).values({
        sessionId: o.newId, instanceId: o.instanceId, workspaceSlug: o.slug, title: o.title ? titleFrom(o.title) : null, archived: false,
        createdAt: now, lastActiveAt: now, model: f.model, modelProvider: f.model ? f.modelProvider : null, effort: f.effort,
        pinned: f.pinned, copiedFrom: o.copiedFrom, replacesId: o.replaces ? f.id : null,
        // same agent and personality; « Sans confirmation » only stays on the same session for the user (a replacement)
        profile: f.profile, personality: f.personality, autoApprove: o.replaces ? f.autoApprove : false,
      }).run();
      for (const r of runs) {
        tx.insert(runStats).values({ ...r, runId: `${r.runId}@${o.newId}`, sessionId: o.newId, hermesSessionId: o.newId, costFinal: true })
          .onConflictDoNothing().run();
      }
      if (o.replaces) {
        // the goal follows the copy that replaces its session, paused (the user rewrote the conversation)
        moveGoalStatement(tx, o.instanceId, f.id, o.newId, now).run();
        tx.update(sessionWorkspace).set({ deletedAt: now })
          .where(and(eq(sessionWorkspace.instanceId, o.instanceId), eq(sessionWorkspace.sessionId, f.id), alive)).run();
      }
    });
    return { session: this.getSession(o.instanceId, o.newId).session, undoUntil: o.replaces ? now + UNDO_MS : null };
  }

  /**
   * Start of an undo of a replacement: pushes the original's undo window to `now` when it is still open (the purger
   * then leaves it alone while the copy's run stops). False = too late.
   */
  holdWindow(instanceId: string, id: string, now = Date.now()): boolean {
    const res = this.db.update(sessionWorkspace).set({ deletedAt: now })
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, id), gt(sessionWorkspace.deletedAt, now - UNDO_MS))).run();
    return res.changes > 0;
  }

  /** Undo of a replacement, in one transaction: the original back, the copy hidden (purged at Hermes later). */
  swapBack(instanceId: string, originalId: string, copyId: string, now = Date.now()): boolean {
    return this.db.transaction((tx) => {
      const back = tx.update(sessionWorkspace).set({ deletedAt: null })
        .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, originalId), gt(sessionWorkspace.deletedAt, now - UNDO_MS))).run();
      if (!back.changes) return false;
      tx.update(sessionWorkspace).set({ deletedAt: now })
        .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, copyId), alive)).run();
      moveGoalStatement(tx, instanceId, copyId, originalId, now).run();
      return true;
    });
  }

  /**
   * Row of a session made by a copy (or an empty duplicate) under a known id: same id again (a retried action)
   * gives the existing session back. `copiedFrom` set = the session exists at Hermes without a run from Intendia.
   */
  async adoptSession(
    slug: string, id: string,
    o: {
      title: string | null; model: string | null; provider: string | null; effort: string | null; copiedFrom: string | null;
      /** profile of the copy (null or the workspace's default = the workspace's) and its personality */
      profile?: string | null; personality?: string | null;
    },
  ): Promise<{ session: PublicSession; created: boolean }> {
    const ws = this.getWorkspace(slug);
    const existing = this.db.select().from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, ws.instanceId), eq(sessionWorkspace.sessionId, id))).get();
    if (existing) {
      if (existing.deletedAt !== null || existing.workspaceSlug !== slug) throw new NotFoundError(`Session inconnue : ${id}`);
      return { session: toPublic(existing), created: false };
    }
    try {
      await createSessionDir(this.roots.fs(ws.instanceId), slug, id);
    } catch (err) {
      console.warn(`[intendia] session folder ${slug}/sessions/${id} not created: ${(err as Error).message}`);
    }
    const now = Date.now();
    this.db.insert(sessionWorkspace).values({
      sessionId: id, instanceId: ws.instanceId, workspaceSlug: slug, title: o.title ? titleFrom(o.title) : null, archived: false,
      createdAt: now, lastActiveAt: now, model: o.model, modelProvider: o.model ? o.provider : null, effort: o.effort, copiedFrom: o.copiedFrom,
      profile: o.profile && o.profile !== (ws.profile ?? 'default') ? o.profile : null, personality: o.personality ?? null,
    }).onConflictDoNothing().run();
    return { session: this.getSession(ws.instanceId, id).session, created: true };
  }

  updateSession(
    instanceId: string, sessionId: string,
    patch: {
      title?: string | null; archived?: boolean; pinned?: boolean; model?: string | null; provider?: string | null; effort?: string | null;
      personality?: string | null; autoApprove?: boolean;
      /** the caller checks the session was never sent and the profile has its key */
      profile?: string | null;
    },
  ): PublicSession {
    const { workspace } = this.getSession(instanceId, sessionId);
    const set: Partial<SessionRow> = {};
    if (patch.title !== undefined) set.title = patch.title ? titleFrom(patch.title) : null;
    if (patch.archived !== undefined) set.archived = patch.archived;
    if (patch.pinned !== undefined) set.pinned = patch.pinned;
    if (patch.personality !== undefined) set.personality = patch.personality || null;
    if (patch.autoApprove !== undefined) set.autoApprove = patch.autoApprove;
    if (patch.profile !== undefined) set.profile = patch.profile && patch.profile !== (workspace.profile ?? 'default') ? patch.profile : null;
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

  // ---- deletion with undo (rows stay, hidden, until the purger deletes them at Hermes)

  /** Hides the sessions; returns the end of the undo window. */
  markDeleted(instanceId: string, ids: string[], now = Date.now()): number {
    if (ids.length) {
      this.db.update(sessionWorkspace).set({ deletedAt: now })
        .where(and(eq(sessionWorkspace.instanceId, instanceId), inArray(sessionWorkspace.sessionId, ids), alive)).run();
    }
    return now + UNDO_MS;
  }

  /** Sessions brought back (still in their undo window); the others are gone or taken by the purger. */
  restore(instanceId: string, ids: string[], now = Date.now()): string[] {
    if (!ids.length) return [];
    const where = and(eq(sessionWorkspace.instanceId, instanceId), inArray(sessionWorkspace.sessionId, ids), gt(sessionWorkspace.deletedAt, now - UNDO_MS));
    return this.db.transaction((tx) => {
      const back = tx.select({ id: sessionWorkspace.sessionId }).from(sessionWorkspace).where(where).all().map((r) => r.id);
      if (back.length) tx.update(sessionWorkspace).set({ deletedAt: null }).where(where).run();
      return back;
    });
  }

  /**
   * Deleted sessions due for a purge attempt: undo window over, or taken before and due again. Marked as taken
   * (deleted_at 0: no longer restorable) with their next attempt in the same transaction; the oldest due first, so
   * rows that keep failing do not hold every slot.
   */
  claimPurgeable(now: number, limit: number): PurgeItem[] {
    const due = sql`coalesce(${sessionWorkspace.purgeAfter}, ${sessionWorkspace.deletedAt} + ${UNDO_MS})`;
    return this.db.transaction((tx) => {
      const rows = tx.select({ instanceId: sessionWorkspace.instanceId, sessionId: sessionWorkspace.sessionId, profile: sessionProfile })
        .from(sessionWorkspace)
        .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
        .where(or(
          and(gt(sessionWorkspace.deletedAt, 0), lte(sessionWorkspace.deletedAt, now - UNDO_MS)),
          and(eq(sessionWorkspace.deletedAt, 0), lte(sessionWorkspace.purgeAfter, now)),
        ))
        .orderBy(asc(due)).limit(limit).all();
      for (const r of rows) {
        tx.update(sessionWorkspace).set({ deletedAt: 0, purgeAfter: now + PURGE_RETRY_MS })
          .where(and(eq(sessionWorkspace.instanceId, r.instanceId), eq(sessionWorkspace.sessionId, r.sessionId))).run();
      }
      return rows.map((r) => ({ ...r, profile: r.profile ?? 'default' }));
    });
  }

  /** Drops a row for good (after Hermes deleted the session). */
  dropRow(instanceId: string, sessionId: string): void {
    this.db.delete(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId))).run();
  }

  /** Never used sessions of the instance (no run, not a copy, not pinned) created before `now - UNUSED_AFTER_MS`. */
  unusedSessions(instanceId: string, now = Date.now()): string[] {
    return this.db.select({ id: sessionWorkspace.sessionId }).from(sessionWorkspace)
      .where(and(
        eq(sessionWorkspace.instanceId, instanceId), alive, isNull(sessionWorkspace.lastRunId), isNull(sessionWorkspace.copiedFrom),
        eq(sessionWorkspace.pinned, false), lte(sessionWorkspace.createdAt, now - UNUSED_AFTER_MS),
      )).all().map((r) => r.id);
  }

  /** Profiles chosen per session on an instance (other than their workspace's). */
  sessionProfiles(instanceId: string): string[] {
    return this.db.selectDistinct({ p: sessionWorkspace.profile }).from(sessionWorkspace)
      .where(and(eq(sessionWorkspace.instanceId, instanceId), isNotNull(sessionWorkspace.profile), alive)).all().map((r) => r.p!);
  }

  /** Approvals given by Intendia for a run (« Sans confirmation »). */
  addAutoApproved(instanceId: string, runId: string): void {
    this.db.update(runStats).set({ autoApproved: sql`${runStats.autoApproved} + 1` })
      .where(and(eq(runStats.instanceId, instanceId), eq(runStats.runId, runId))).run();
  }

  /** Moves a session row to another workspace (the caller checks instance, profile and folder). */
  moveSession(instanceId: string, sessionId: string, slug: string): void {
    this.db.update(sessionWorkspace).set({ workspaceSlug: slug })
      .where(and(eq(sessionWorkspace.instanceId, instanceId), eq(sessionWorkspace.sessionId, sessionId), alive)).run();
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
        title: sessionWorkspace.title, runId: sessionWorkspace.lastRunId, profile: sessionProfile, workspaceName: workspaces.name,
        lastActiveAt: sessionWorkspace.lastActiveAt, autoApprove: sessionWorkspace.autoApprove,
      }).from(sessionWorkspace)
        .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
        .where(and(isNotNull(sessionWorkspace.lastRunId), gte(sessionWorkspace.lastActiveAt, sinceMs), alive))
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

  insertRunStat(row: Omit<RunStatRow, 'costFinal' | 'costRuns' | 'endedAt' | 'hermesSessionId' | 'servedModel' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'costUsd' | 'autoApproved'> & { costRuns?: number }): void {
    this.db.insert(runStats).values({ ...row, costRuns: row.costRuns ?? 1, costFinal: false }).onConflictDoNothing().run();
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

  /**
   * Runs ended in the last 24 h, most recent first (50 at most), of live sessions: one instance or all. Copies made by
   * Dupliquer (`runId` with `@`) are left out, they did not run again.
   */
  finishedRuns(opts: { instanceId?: string; now?: number } = {}): FinishedRun[] {
    const now = opts.now ?? Date.now();
    return this.db.select({
      instance: runStats.instanceId, workspace: sessionWorkspace.workspaceSlug, workspaceName: workspaces.name,
      sessionId: runStats.sessionId, title: sessionWorkspace.title, runId: runStats.runId, status: runStats.status,
      startedAt: runStats.startedAt, endedAt: runStats.endedAt, costUsd: runStats.costUsd,
    }).from(runStats)
      .innerJoin(sessionWorkspace, and(eq(sessionWorkspace.instanceId, runStats.instanceId), eq(sessionWorkspace.sessionId, runStats.sessionId)))
      .innerJoin(workspaces, eq(workspaces.slug, sessionWorkspace.workspaceSlug))
      .where(and(
        ...(opts.instanceId !== undefined ? [eq(runStats.instanceId, opts.instanceId)] : []),
        ne(runStats.status, 'running'), isNotNull(runStats.endedAt), gte(runStats.endedAt, now - FINISHED_WINDOW_MS),
        notLike(runStats.runId, '%@%'), alive,
      ))
      .orderBy(desc(runStats.endedAt)).limit(FINISHED_LIMIT).all()
      .map((r) => ({ ...r, endedAt: r.endedAt! }));
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
  framingLines(ws: Workspace, folder: string): { workdir: string; store: string; share: string; artifact: string } {
    const path = this.agentPath(ws);
    return {
      workdir: `Dossier de travail : ${path}/`,
      store: `Range chaque fichier que tu produis dans ${path}/${folder}/.`,
      share: "Si l'outil share_file est disponible, appelle-le pour chaque fichier livré avec son chemin complet et donne le lien renvoyé.",
      artifact: `Pour montrer une page HTML dans la conversation, écris-la dans ${path}/${folder}/, autonome (CSS et JS dans le fichier, aucune ressource externe), puis écris seule sur une ligne : ::artefact <chemin complet>`,
    };
  }

  /**
   * The framing block sent in `instructions` with every run. Hermes' dashboard down: the last AGENTS.md read
   * (kept in memory), else a line saying the instructions are unavailable; no workspace root: no folder lines.
   */
  async instructionsFor(ctx: SessionContext): Promise<string> {
    const ws = ctx.workspace;
    let path: string;
    try {
      path = this.agentPath(ws);
    } catch (err) {
      return [`[Intendia] Workspace : ${ws.name} (${ws.slug})`, `Fichiers du workspace indisponibles : ${(err as Error).message}`].join('\n');
    }
    let text: string;
    try {
      text = framingAgentsMd(await this.readAgentsMd(ws.slug), path) || '(aucune)';
    } catch (err) {
      const last = this.agentsMd.get(ws.slug);
      text = last !== undefined ? framingAgentsMd(last, path) || '(aucune)' : `Consignes du projet indisponibles (${(err as Error).message})`;
    }
    const lines = this.framingLines(ws, `sessions/${ctx.session.id}`);
    return [
      `[Intendia] Workspace : ${ws.name} (${ws.slug})`,
      lines.workdir,
      lines.store,
      lines.share,
      lines.artifact,
      `Consignes du projet (${path}/AGENTS.md) :`,
      text,
    ].join('\n');
  }
}
