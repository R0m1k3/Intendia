import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { EFFORTS } from '../chat/run-stats.js';
import { PERSONALITY_RE } from '../sessions/personalities.js';
import { PROFILE_RE } from './params.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { pushTitle } from '../workspaces/title.js';
import { SESSION_SOURCES, type SessionSource } from '../sessions/recent.js';
import { NotFoundError, ValidationError, type SessionContext, type WorkspaceService } from '../workspaces/service.js';
import { createSessionDir, WorkspaceFsError } from '../workspaces/fs.js';
import { runKey, startingRuns, whenIdle } from '../chat/history.js';
import type { HermesFs } from '../files/hermes-fs.js';
import { msg } from '../i18n/index.js';

/** Session ids: Intendia's own (iw-…) and external ones (Telegram, CLI) whose format is not documented. */
export const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

const CreateWorkspace = z.object({
  slug: z.string().regex(SLUG_RE, msg('slug : a-z, 0-9 et tiret, 40 caractères au plus')),
  name: z.string().trim().min(1).max(80),
  instanceId: z.string().min(1),
  profile: z.string().max(64).nullish(),
});
// the model is chosen per session, in the chat (a `model` sent here is ignored)
const PatchWorkspace = z.object({ name: z.string().trim().min(1).max(80).optional() });
const AgentsMd = z.object({ text: z.string() });
const PatchSession = z.object({
  title: z.string().max(200).nullish(),
  archived: z.boolean().optional(),
  /** Kept by Intendia only (first in the lists). */
  pinned: z.boolean().optional(),
  /** null = Hermes default */
  model: z.string().trim().min(1).max(200).regex(/^[^\s]+$/, msg('nom de modèle sans espace ni saut de ligne')).nullable().optional(),
  /** Provider of `model` (picker group); accepts `custom:<name>` keys. Only with `model`. */
  provider: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, msg('fournisseur invalide')).nullable().optional(),
  effort: z.enum(EFFORTS).nullable().optional(),
  /** 'hermes:<name>' | 'intendia:<prompt id>' | null */
  personality: z.string().regex(PERSONALITY_RE).nullable().optional(),
  /** « Sans confirmation » */
  autoApprove: z.boolean().optional(),
  /** another profile of the instance (with its key), only before the first message; null = the workspace's */
  profile: z.string().regex(PROFILE_RE).nullable().optional(),
});

const Ids = z.array(z.string().regex(SESSION_ID_RE)).min(1).max(200)
  .refine((ids) => new Set(ids).size === ids.length, msg('identifiants en double'));
const BulkBody = z.object({
  ids: Ids,
  action: z.enum(['archive', 'unarchive', 'pin', 'unpin', 'delete', 'move']),
  workspace: z.string().regex(SLUG_RE).optional(),
}).refine((b) => b.action !== 'move' || b.workspace, { message: msg('workspace requis pour déplacer'), path: ['workspace'] });
const RestoreBody = z.object({ ids: Ids });

export const RUN_ACTIVE = msg('Un travail est en cours');
const MOVE_FILES = msg("Ses fichiers resteraient dans l'ancien workspace");

export function sessionParams(c: { req: { param: (k: string) => string } }): { inst: string; id: string } {
  const inst = c.req.param('inst');
  const id = c.req.param('id');
  if (!SESSION_ID_RE.test(id) || !SLUG_RE.test(inst)) throw new ValidationError(msg('identifiant invalide'));
  return { inst, id };
}

function sourceOf(raw: string | undefined): SessionSource {
  if (raw === undefined || raw === '') return 'all';
  if (!(SESSION_SOURCES as readonly string[]).includes(raw)) throw new ValidationError(msg('source : {sources}', { sources: SESSION_SOURCES.join(', ') }));
  return raw as SessionSource;
}

export function workspaceRoutes(deps: AppDeps & { workspaces: WorkspaceService }): Hono {
  const { workspaces } = deps;
  const r = new Hono();

  r.get('/workspaces', (c) => {
    const counts = workspaces.sessionCounts();
    return c.json({ workspaces: workspaces.listWorkspaces().map((w) => ({ ...w, sessionCount: counts.get(w.slug) ?? 0 })) });
  });

  // sessions of every source (Intendia, Telegram, crons…) of one instance, for the home and Sessions pages
  r.get('/i/:inst/sessions/recent', async (c) => {
    const raw = c.req.query('limit');
    const limit = raw === undefined ? 20 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationError(msg('limit : entier de 1 à 200'));
    return c.json(await deps.services.recent.list(c.req.param('inst'), limit, sourceOf(c.req.query('source'))));
  });

  // search: Intendia titles, plus message content through the instance's dashboard
  r.get('/i/:inst/sessions/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2 || q.length > 100) throw new ValidationError(msg('q : de 2 à 100 caractères'));
    return c.json(await deps.services.recent.search(c.req.param('inst'), q, sourceOf(c.req.query('source'))));
  });

  r.post('/workspaces', async (c) => {
    const body = CreateWorkspace.parse(await c.req.json());
    return c.json({ workspace: await workspaces.createWorkspace(body) }, 201);
  });

  r.get('/workspaces/:slug', (c) => c.json({ workspace: workspaces.getWorkspace(c.req.param('slug')) }));

  r.patch('/workspaces/:slug', async (c) => {
    const body = PatchWorkspace.parse(await c.req.json());
    return c.json({ workspace: workspaces.updateWorkspace(c.req.param('slug'), body) });
  });

  r.get('/workspaces/:slug/agents-md', async (c) => c.json({ text: await workspaces.readAgentsMd(c.req.param('slug')) }));

  r.put('/workspaces/:slug/agents-md', async (c) => {
    const { text } = AgentsMd.parse(await c.req.json());
    await workspaces.writeAgentsMd(c.req.param('slug'), text);
    return c.json({ ok: true });
  });

  r.get('/workspaces/:slug/sessions', (c) => c.json({
    sessions: workspaces.listSessions(c.req.param('slug'), { archived: c.req.query('archived') === '1' }),
  }));

  r.post('/workspaces/:slug/sessions', async (c) => c.json({ session: await workspaces.createSession(c.req.param('slug')) }, 201));

  r.get('/sessions/:inst/:id', (c) => {
    const { inst, id } = sessionParams(c);
    const ctx = workspaces.getSession(inst, id);
    return c.json({ session: ctx.session, workspace: ctx.workspace, profile: ctx.profile });
  });


  /**
   * Moves a session to another workspace of the same instance and profile. Its folder cannot move (Hermes does not
   * move folders): refused when the agent wrote files there; an empty one is recreated in the target.
   */
  const moveOne = async (ctx: SessionContext, slug: string): Promise<string | null> => {
    const target = workspaces.getWorkspace(slug);
    if (target.instanceId !== ctx.instance.id || (target.profile ?? 'default') !== ctx.profile) return msg('Autre agent');
    if (target.slug === ctx.workspace.slug) return null;
    let refused: string | null = null;
    const idle = await whenIdle(deps.compat, ctx, async () => { refused = await moveFolder(ctx, slug); });
    return idle ? refused : RUN_ACTIVE;
  };

  /** Moves the row, and the session's folder when it is empty; null when done, else why not. */
  const moveFolder = async (ctx: SessionContext, slug: string): Promise<string | null> => {
    const from = `${ctx.workspace.slug}/sessions/${ctx.session.id}`;
    let fs: HermesFs;
    try {
      fs = deps.services.roots.fs(ctx.instance.id);
    } catch (err) {
      // no file root on this instance: the session has no folder, only its row moves
      if (!(err instanceof WorkspaceFsError && err.code === 'no_root')) throw err;
      workspaces.moveSession(ctx.instance.id, ctx.session.id, slug);
      return null;
    }
    let present = true;
    try {
      if ((await fs.list(from)).entries.length) return MOVE_FILES;
    } catch (err) {
      if (!(err instanceof WorkspaceFsError && err.code === 'not_found')) return (err as Error).message;
      present = false;
    }
    // one attempt, as at creation: without it the agent creates the folder when it writes there
    await createSessionDir(fs, slug, ctx.session.id).catch(() => undefined);
    workspaces.moveSession(ctx.instance.id, ctx.session.id, slug);
    if (present) await fs.remove(from, false).catch(() => undefined);
    return null;
  };

  r.patch('/sessions/:inst/:id', async (c) => {
    const { inst, id } = sessionParams(c);
    const body = PatchSession.parse(await c.req.json());
    if (body.profile !== undefined) {
      const ctx = workspaces.getSession(inst, id);
      // a session with a history at Hermes changes agent by a copy (POST …/to-profile)
      // a first message on its way keeps the profile it was sent with
      if (startingRuns.has(runKey(inst, id))) return c.json({ error: RUN_ACTIVE, code: 'run_active' }, 409);
      if (ctx.session.lastRunId || ctx.session.copiedFrom) {
        return c.json({ error: msg('Cette session a déjà des messages : copiez-la vers l’autre agent'), code: 'has_history' }, 409);
      }
      if (body.profile && body.profile !== 'default' && !ctx.instance.profileKeys[body.profile]) {
        return c.json({ error: msg('Profil sans clé sur cette instance : {profile}', { profile: body.profile }), code: 'no_key' }, 400);
      }
    }
    if (body.autoApprove === true) {
      // relaunches with every action approved by itself: only within a budget (chat/goal.ts)
      const goal = deps.services.goals.get(inst, id);
      if (goal && goal.status !== 'done' && goal.budgetUsd === null) {
        return c.json({ error: msg('Fixez d’abord un budget à l’objectif de cette session'), code: 'goal_budget_required' }, 400);
      }
    }
    const session = workspaces.updateSession(inst, id, body);
    if (body.title !== undefined) await pushTitle(deps, workspaces.getSession(inst, id), session.title);
    return c.json({ session });
  });

  // deletion with undo: hidden now, deleted at Hermes by the purger once the undo window is over
  r.delete('/sessions/:inst/:id', async (c) => {
    const { inst, id } = sessionParams(c);
    const ctx = workspaces.getSession(inst, id);
    let undoUntil = 0;
    if (!await whenIdle(deps.compat, ctx, () => { undoUntil = workspaces.markDeleted(inst, [id]); })) {
      return c.json({ error: RUN_ACTIVE, code: 'run_active' }, 409);
    }
    return c.json({ ok: true, undoUntil });
  });

  r.post('/i/:inst/sessions/restore', async (c) => {
    const inst = c.req.param('inst');
    const { ids } = RestoreBody.parse(await c.req.json());
    const restored = workspaces.restore(inst, ids);
    if (!restored.length) return c.json({ error: msg('Trop tard : la suppression est faite'), code: 'too_late' }, 409);
    return c.json({ restored });
  });

  r.post('/i/:inst/sessions/bulk', async (c) => {
    const inst = c.req.param('inst');
    const { ids, action, workspace } = BulkBody.parse(await c.req.json());
    const results: { id: string; ok: boolean; error?: string }[] = [];
    let undoUntil: number | undefined;
    for (const id of ids) {
      let ctx: SessionContext;
      try {
        ctx = workspaces.getSession(inst, id);
      } catch (err) {
        if (err instanceof NotFoundError) { results.push({ id, ok: false, error: msg('Introuvable') }); continue; }
        throw err;
      }
      try {
        let error: string | null = null;
        if (action === 'archive' || action === 'unarchive') workspaces.updateSession(inst, id, { archived: action === 'archive' });
        else if (action === 'pin' || action === 'unpin') workspaces.updateSession(inst, id, { pinned: action === 'pin' });
        else if (action === 'delete') {
          // checked and hidden one by one, each under the session's reservation (no send can start in between)
          if (!await whenIdle(deps.compat, ctx, () => { undoUntil = workspaces.markDeleted(inst, [id]); })) error = RUN_ACTIVE;
        } else error = await moveOne(ctx, workspace!);
        results.push(error ? { id, ok: false, error } : { id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    return c.json({ results, ...(undoUntil ? { undoUntil } : {}) });
  });

  // clean-up: Intendia sessions never used (they do not exist at Hermes), deleted with the same undo
  r.get('/i/:inst/sessions/cleanup', (c) => c.json({ unused: workspaces.unusedSessions(c.req.param('inst')).length }));
  r.post('/i/:inst/sessions/cleanup', (c) => {
    const inst = c.req.param('inst');
    // synchronous from the read to the mark: no send can start in between; a first send being started is skipped.
    // At most 200 at a time, the size the undo accepts.
    const ids = workspaces.unusedSessions(inst).filter((id) => !startingRuns.has(runKey(inst, id))).slice(0, 200);
    return c.json({ ids, undoUntil: workspaces.markDeleted(inst, ids) });
  });

  return r;
}
