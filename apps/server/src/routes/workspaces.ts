import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { callOp, HermesError } from '../connectors/runtime.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { ValidationError, type SessionContext, type WorkspaceService } from '../workspaces/service.js';

/** Session ids: Intendia's own (iw-…) and external ones (Telegram, CLI) whose format is not documented. */
export const SESSION_ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

const CreateWorkspace = z.object({
  slug: z.string().regex(SLUG_RE, 'slug : a-z, 0-9 et tiret, 40 caractères au plus'),
  name: z.string().trim().min(1).max(80),
  instanceId: z.string().min(1),
  profile: z.string().max(64).nullish(),
  model: z.string().max(200).nullish(),
});
const PatchWorkspace = z.object({ name: z.string().trim().min(1).max(80).optional(), model: z.string().max(200).nullish() });
const AgentsMd = z.object({ text: z.string() });
const PatchSession = z.object({ title: z.string().max(200).nullish(), archived: z.boolean().optional() });

export function sessionParams(c: { req: { param: (k: string) => string } }): { inst: string; id: string } {
  const inst = c.req.param('inst');
  const id = c.req.param('id');
  if (!SESSION_ID_RE.test(id) || !SLUG_RE.test(inst)) throw new ValidationError('identifiant invalide');
  return { inst, id };
}

/** Sends the title to Hermes so Telegram or the CLI show the same; failures are ignored. */
async function pushTitle(deps: AppDeps, ctx: SessionContext, title: string | null): Promise<void> {
  if (!title) return;
  try {
    await callOp(deps.compat.http(ctx.instance.id), deps.compat.get(ctx.instance.id), 'sessions', 'update', {
      params: { session_id: ctx.session.id }, body: { title }, profile: ctx.profile,
    });
  } catch {
    // the session may not exist at Hermes yet, or the route may be missing: the local title stays right
  }
}

export function workspaceRoutes(deps: AppDeps & { workspaces: WorkspaceService }): Hono {
  const { workspaces } = deps;
  const r = new Hono();

  r.get('/workspaces', (c) => c.json({ workspaces: workspaces.listWorkspaces() }));

  r.post('/workspaces', async (c) => {
    const body = CreateWorkspace.parse(await c.req.json());
    return c.json({ workspace: workspaces.createWorkspace(body) }, 201);
  });

  r.get('/workspaces/:slug', (c) => c.json({ workspace: workspaces.getWorkspace(c.req.param('slug')) }));

  r.patch('/workspaces/:slug', async (c) => {
    const body = PatchWorkspace.parse(await c.req.json());
    return c.json({ workspace: workspaces.updateWorkspace(c.req.param('slug'), body) });
  });

  r.get('/workspaces/:slug/agents-md', (c) => c.json({ text: workspaces.readAgentsMd(c.req.param('slug')) }));

  r.put('/workspaces/:slug/agents-md', async (c) => {
    const { text } = AgentsMd.parse(await c.req.json());
    workspaces.writeAgentsMd(c.req.param('slug'), text);
    return c.json({ ok: true });
  });

  r.get('/workspaces/:slug/sessions', (c) => c.json({
    sessions: workspaces.listSessions(c.req.param('slug'), { archived: c.req.query('archived') === '1' }),
  }));

  r.post('/workspaces/:slug/sessions', (c) => c.json({ session: workspaces.createSession(c.req.param('slug')) }, 201));

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
