import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { readHistory, whenIdle } from '../chat/history.js';
import { callOp } from '../connectors/runtime.js';
import { ExportSchema } from '../connectors/sessions/index.js';
import { copyId, copyPayload, CopyError, exportSession, importCopy, type Exported } from '../sessions/copy.js';
import { agentName, attachmentHeader, toHtml, toMarkdown } from '../sessions/export.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { NotFoundError, ValidationError, type WorkspaceService } from '../workspaces/service.js';
import { RUN_ACTIVE, SESSION_ID_RE, sessionParams } from './workspaces.js';

/** Created by the browser once per action: the same key again gives the same copy. */
const Key = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'clé invalide');
const DuplicateBody = z.object({ key: Key });
const ContinueBody = z.object({ key: Key, profile: z.string().max(64).default('default'), workspace: z.string().regex(SLUG_RE) });
const ImportBody = z.object({ key: Key, file: z.unknown() });

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** A file of an Intendia or Hermes export: the session itself, or `{sessions: [one]}`. */
function exportedFromFile(file: unknown): Exported {
  const one = file && typeof file === 'object' && Array.isArray((file as { sessions?: unknown }).sessions)
    ? (file as { sessions: unknown[] }).sessions
    : null;
  if (one && one.length !== 1) throw new CopyError('invalid', 'Le fichier contient plusieurs sessions : importez-les une par une', 400);
  const parsed = ExportSchema.safeParse(one ? one[0] : file);
  if (!parsed.success) throw new CopyError('invalid', 'Fichier non reconnu : un export JSON de session est attendu', 400);
  return parsed.data;
}

/** Duplicate, continue a session born elsewhere, import a file, export (Markdown, HTML, JSON). */
export function sessionCopyRoutes(deps: AppDeps & { workspaces: WorkspaceService }): Hono {
  const { workspaces, compat } = deps;
  const r = new Hono();

  r.post('/sessions/:inst/:id/duplicate', async (c) => {
    const { inst, id } = sessionParams(c);
    const { key } = DuplicateBody.parse(await c.req.json());
    const ctx = workspaces.getSession(inst, id);
    const { session: s, workspace } = ctx;
    const newId = copyId(inst, workspace.slug, key);
    const title = `${s.title || 'Nouvelle session'} (copie)`;
    const options = { model: s.model, provider: s.modelProvider, effort: s.effort };
    const done = workspaces.existingCopy(workspace.slug, newId);
    if (done) return c.json({ session: done });
    // never sent to Hermes: nothing to copy there, a new empty session with the same options
    if (!s.lastRunId && !s.copiedFrom) {
      const res = await workspaces.adoptSession(workspace.slug, newId, { title, ...options, copiedFrom: null });
      return c.json({ session: res.session }, res.created ? 201 : 200);
    }
    let created = false;
    let out: Awaited<ReturnType<WorkspaceService['adoptSession']>> | null = null;
    // a run going on would give a partial copy
    const idle = await whenIdle(compat, ctx, async () => {
      const exported = await exportSession(compat, inst, ctx.profile, id);
      await importCopy(compat, inst, ctx.profile, copyPayload(exported, { id: newId, title }));
      out = await workspaces.adoptSession(workspace.slug, newId, { title, ...options, copiedFrom: id });
      created = out.created;
    });
    if (!idle) return c.json({ error: RUN_ACTIVE, code: 'run_active' }, 409);
    return c.json({ session: out!.session }, created ? 201 : 200);
  });

  r.post('/i/:inst/external/:id/continue', async (c) => {
    const inst = c.req.param('inst');
    const id = c.req.param('id');
    if (!SLUG_RE.test(inst) || !SESSION_ID_RE.test(id)) throw new ValidationError('identifiant invalide');
    const body = ContinueBody.parse(await c.req.json());
    const instance = deps.store.get(inst);
    if (!instance) throw new NotFoundError(`Instance inconnue : ${inst}`);
    if (body.profile !== 'default' && !instance.profileKeys[body.profile]) throw new ValidationError(`Profil inconnu : ${body.profile}`);
    const ws = workspaces.getWorkspace(body.workspace);
    if (ws.instanceId !== inst) throw new ValidationError('Workspace d’une autre instance');
    // the history stays with its profile: a copy is only made in a workspace of that profile
    if ((ws.profile ?? 'default') !== body.profile) return c.json({ error: 'Workspace d’un autre agent', code: 'other_profile' }, 400);
    const newId = copyId(inst, ws.slug, body.key);
    const done = workspaces.existingCopy(ws.slug, newId);
    if (done) return c.json({ session: done });
    const exported = await exportSession(compat, inst, body.profile, id);
    const title = exported.title?.trim() || `Suite de ${exported.source ?? 'session'}`;
    await importCopy(compat, inst, body.profile, copyPayload(exported, { id: newId, title }));
    const res = await workspaces.adoptSession(ws.slug, newId, { title, model: ws.model, provider: ws.modelProvider, effort: ws.effort, copiedFrom: id });
    return c.json({ session: res.session }, res.created ? 201 : 200);
  });

  r.post('/workspaces/:slug/sessions/import', bodyLimit({
    maxSize: IMPORT_MAX_BYTES,
    onError: (c) => c.json({ error: 'Fichier trop gros (10 Mo au plus)', code: 'too_large' }, 413),
  }), async (c) => {
    const ws = workspaces.getWorkspace(c.req.param('slug'));
    const { key, file } = ImportBody.parse(await c.req.json());
    const exported = exportedFromFile(file);
    const newId = copyId(ws.instanceId, ws.slug, key);
    const done = workspaces.existingCopy(ws.slug, newId);
    if (done) return c.json({ session: done });
    const title = exported.title?.trim() || 'Session importée';
    const profile = ws.profile ?? 'default';
    await importCopy(compat, ws.instanceId, profile, copyPayload(exported, { id: newId, title, untrusted: true }));
    const res = await workspaces.adoptSession(ws.slug, newId, { title, model: ws.model, provider: ws.modelProvider, effort: ws.effort, copiedFrom: `import:${key}` });
    return c.json({ session: res.session }, res.created ? 201 : 200);
  });

  r.get('/sessions/:inst/:id/export', async (c) => {
    const { inst, id } = sessionParams(c);
    const format = c.req.query('format') ?? 'md';
    if (format !== 'md' && format !== 'html' && format !== 'json') throw new ValidationError('format : md, html ou json');
    const ctx = workspaces.getSession(inst, id);
    const title = ctx.session.title || 'Nouvelle session';
    if (format === 'json') {
      const exported = await exportSession(compat, inst, ctx.profile, id);
      return c.body(JSON.stringify(exported, null, 2), 200, {
        'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': attachmentHeader(title, 'json'),
      });
    }
    const h = await readHistory(compat, inst, id, ctx.profile);
    if (!h.exists) throw new CopyError('empty', 'Session vide : rien à exporter', 404);
    let startedAt: number | null = null;
    try {
      const s = await callOp<{ started_at?: number | null; session?: { started_at?: number | null } }>(compat.http(inst), compat.get(inst), 'sessions', 'get', {
        params: { session_id: h.liveId }, profile: ctx.profile,
      });
      startedAt = s.session?.started_at ?? s.started_at ?? null;
    } catch {
      // the date is only a heading
    }
    const head = { title, startedAt, agent: agentName(ctx.profile, ctx.instance.label) };
    if (format === 'md') {
      return c.body(toMarkdown(head, h.messages), 200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': attachmentHeader(title, 'md') });
    }
    return c.body(toHtml(head, h.messages), 200, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': attachmentHeader(title, 'html'),
      // opened by mistake in the browser: still no script
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
  });

  return r;
}
