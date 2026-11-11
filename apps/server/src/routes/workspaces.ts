import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import { EFFORTS } from '../chat/run-stats.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { pushTitle } from '../workspaces/title.js';
import { SESSION_SOURCES, type SessionSource } from '../sessions/recent.js';
import { ValidationError, type WorkspaceService } from '../workspaces/service.js';

/** Session ids: Intendia's own (iw-…) and external ones (Telegram, CLI) whose format is not documented. */
export const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

const CreateWorkspace = z.object({
  slug: z.string().regex(SLUG_RE, 'slug : a-z, 0-9 et tiret, 40 caractères au plus'),
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
  /** null = Hermes default */
  model: z.string().trim().min(1).max(200).regex(/^[^\s]+$/, 'nom de modèle sans espace ni saut de ligne').nullable().optional(),
  /** Provider of `model` (picker group); accepts `custom:<name>` keys. Only with `model`. */
  provider: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, 'fournisseur invalide').nullable().optional(),
  effort: z.enum(EFFORTS).nullable().optional(),
});

export function sessionParams(c: { req: { param: (k: string) => string } }): { inst: string; id: string } {
  const inst = c.req.param('inst');
  const id = c.req.param('id');
  if (!SESSION_ID_RE.test(id) || !SLUG_RE.test(inst)) throw new ValidationError('identifiant invalide');
  return { inst, id };
}

function sourceOf(raw: string | undefined): SessionSource {
  if (raw === undefined || raw === '') return 'all';
  if (!(SESSION_SOURCES as readonly string[]).includes(raw)) throw new ValidationError(`source : ${SESSION_SOURCES.join(', ')}`);
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
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationError('limit : entier de 1 à 200');
    return c.json(await deps.services.recent.list(c.req.param('inst'), limit, sourceOf(c.req.query('source'))));
  });

  // search: Intendia titles, plus message content through the instance's dashboard
  r.get('/i/:inst/sessions/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2 || q.length > 100) throw new ValidationError('q : de 2 à 100 caractères');
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

  r.patch('/sessions/:inst/:id', async (c) => {
    const { inst, id } = sessionParams(c);
    const body = PatchSession.parse(await c.req.json());
    const session = workspaces.updateSession(inst, id, body);
    if (body.title !== undefined) await pushTitle(deps, workspaces.getSession(inst, id), session.title);
    return c.json({ session });
  });

  r.delete('/sessions/:inst/:id', async (c) => {
    const { inst, id } = sessionParams(c);
    const ctx = workspaces.getSession(inst, id);
    try {
      await callOp(deps.compat.http(inst), deps.compat.get(inst), 'sessions', 'remove', {
        params: { session_id: id }, profile: ctx.profile,
      });
    } catch (err) {
      // never sent to Hermes (no message yet): nothing to delete there
      if (!(err instanceof HermesError && err.detail.status === 404)) throw err;
    }
    workspaces.deleteSession(inst, id);
    return c.json({ ok: true });
  });

  return r;
}
