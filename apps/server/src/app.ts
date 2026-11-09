import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { InstanceConfigSchema, type AppConfig } from './config.js';
import { Auth, AuthError, requireAuth } from './auth/auth.js';
import type { CompatService } from './compat/service.js';
import { checkInstance } from './compat/engine.js';
import type { Db } from './db/index.js';
import { HermesError, HermesHttp, type FetchLike } from './hermes/http.js';
import { InstanceStore } from './instances/store.js';
import { ModuleUnavailableError } from './connectors/runtime.js';
import { forgetMcpToken, mcpToken, mcpUrl, rotateMcpToken } from './mcp/server.js';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { linkRoutes, publicLinkRoute } from './routes/links.js';
import type { Services } from './services.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { FS_ERROR_STATUS, WorkspaceFsError } from './workspaces/fs.js';
import { NotFoundError, ValidationError } from './workspaces/service.js';

export interface AppDeps {
  config: AppConfig;
  db: Db;
  auth: Auth;
  store: InstanceStore;
  compat: CompatService;
  services: Services;
  fetchImpl?: FetchLike;
  version: string;
}

const PasswordBody = z.object({ password: z.string().min(1).max(1024) });
const SetupBody = z.object({ code: z.string().min(1).max(64), password: z.string().min(1).max(1024) });

export function createApp(deps: AppDeps) {
  const { auth, store, compat, config } = deps;
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    // file routes allow framing by Intendia itself (preview); every other response stays DENY
    if (!c.res.headers.has('X-Frame-Options')) c.header('X-Frame-Options', 'DENY');
  });

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    if (err instanceof z.ZodError) return c.json({ error: 'invalid request', issues: err.issues }, 400);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof WorkspaceFsError) {
      return c.json({ error: err.message, code: err.code }, FS_ERROR_STATUS[err.code]);
    }
    if (err instanceof ModuleUnavailableError) {
      return c.json({ error: err.message, module: err.module, op: err.op, reasons: err.reasons }, 409);
    }
    if (err instanceof HermesError) {
      if (err.kind === 'http') return c.json({ error: err.message, hermesStatus: err.detail.status ?? null }, 502);
      if (err.kind === 'network' || err.kind === 'timeout') return c.json({ error: err.message }, 504);
      if (err.kind === 'unconfigured') return c.json({ error: err.message }, 422);
      return c.json({ error: err.message }, 502);
    }
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  const x = new Hono();

  // ---- public: health, first-run state, login
  x.get('/health', (c) => c.json({ ok: true, version: deps.version }));

  x.get('/setup', (c) => c.json({
    needsPassword: auth.needsPassword(),
    needsInstance: store.list().length === 0,
    declarativeInstances: store.declarative,
    authenticated: auth.isAuthenticated(c),
    version: deps.version,
  }));

  x.post('/setup/password', async (c) => {
    auth.rateLimit(auth.clientIp(c));
    const body = SetupBody.parse(await c.req.json());
    await auth.setInitialPassword(body.code, body.password);
    auth.createSession(c);
    return c.json({ ok: true });
  });

  x.post('/login', async (c) => {
    auth.rateLimit(auth.clientIp(c));
    const { password } = PasswordBody.parse(await c.req.json());
    if (!(await auth.checkPassword(password))) return c.json({ error: 'Mot de passe incorrect' }, 401);
    auth.createSession(c);
    return c.json({ ok: true });
  });

  x.post('/logout', (c) => {
    auth.destroySession(c);
    return c.json({ ok: true });
  });

  // ---- authenticated
  const priv = new Hono();
  priv.use('*', requireAuth(auth));

  priv.get('/instances', (c) => c.json({
    declarative: store.declarative,
    instances: store.list().map((i) => InstanceStore.toPublic(i, store.declarative ? 'env' : 'db')),
  }));

  /** Tests a connection without saving: full compatibility check against the given settings. */
  priv.post('/instances/test', async (c) => {
    const inst = InstanceConfigSchema.parse(await c.req.json());
    const { report } = await checkInstance(new HermesHttp(inst, deps.fetchImpl));
    return c.json(report);
  });

  priv.post('/instances', async (c) => {
    const inst = InstanceConfigSchema.parse(await c.req.json());
    const { report } = await checkInstance(new HermesHttp(inst, deps.fetchImpl));
    if (!report.api.reachable) return c.json({ error: `API server injoignable : ${report.api.error ?? '?'}`, report }, 422);
    store.save(inst);
    const saved = await compat.check(inst.id);
    return c.json({ instance: InstanceStore.toPublic(inst, 'db'), report: saved });
  });

  priv.delete('/instances/:id', (c) => {
    store.remove(c.req.param('id'));
    forgetMcpToken(deps.db, c.req.param('id'));
    compat.forget(c.req.param('id'));
    return c.json({ ok: true });
  });

  priv.get('/compat', (c) => c.json({ reports: compat.all() }));

  priv.post('/compat/:id/check', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'instance inconnue' }, 404);
    return c.json(await compat.check(id));
  });

  /** share_file connection details for one instance (URL, bearer token). */
  const mcpInfo = (id: string) => ({ url: mcpUrl(config, id), token: mcpToken(deps.db, id), publicUrlSet: Boolean(config.publicUrl) });
  priv.get('/instances/:id/mcp', (c) => {
    if (!store.get(c.req.param('id'))) return c.json({ error: 'instance inconnue' }, 404);
    return c.json(mcpInfo(c.req.param('id')));
  });
  priv.post('/instances/:id/mcp/rotate', (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'instance inconnue' }, 404);
    rotateMcpToken(deps.db, id);
    return c.json(mcpInfo(id));
  });

  const { workspaces, files, links } = deps.services;
  priv.route('/', workspaceRoutes({ ...deps, workspaces }));
  priv.route('/', chatRoutes({ ...deps, workspaces }));
  priv.route('/', fileRoutes(files));
  priv.route('/', linkRoutes(links));

  x.route('/', priv);
  app.route('/x', x);
  app.route('/', publicLinkRoute(links, auth));

  // ---- SPA
  const webDir = config.webDir;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8');
    app.use('/assets/*', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
    app.use('/favicon.svg', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
    app.get('*', (c) => {
      if (c.req.path.startsWith('/x/') || c.req.path.startsWith('/f/')) return c.json({ error: 'not found' }, 404);
      return c.html(indexHtml);
    });
  }

  return app;
}
