import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { InstanceConfigSchema, type AppConfig } from './config.js';
import { Auth, AuthError, requireAuth } from './auth/auth.js';
import type { CompatService } from './compat/service.js';
import { checkInstance } from './compat/engine.js';
import { withFilesRoot } from './compat/files-root.js';
import type { Db } from './db/index.js';
import { HermesError, HermesHttp, type FetchLike } from './hermes/http.js';
import { DeclarativeError, InstanceStore } from './instances/store.js';
import { ModuleUnavailableError } from './connectors/runtime.js';
import { forgetMcpToken, mcpToken, mcpUrl } from './mcp/server.js';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { linkRoutes, publicLinkRoute } from './routes/links.js';
import type { Services } from './services.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { FS_ERROR_STATUS, WorkspaceFsError } from './workspaces/fs.js';
import { cronRoutes } from './routes/crons.js';
import { skillRoutes } from './routes/skills.js';
import { agentRoutes } from './routes/agents.js';
import { activityRoutes } from './routes/activity.js';
import { kanbanRoutes } from './routes/kanban.js';
import type { WsFactory } from './connectors/kanban/index.js';
import { AgentConflictError } from './agents/service.js';
import { KanbanError } from './kanban/service.js';
import { configRoutes } from './routes/config.js';
import { ConfigConflictError, ConfigInputError, ConfirmRequiredError, PartialWriteError } from './hermes-config/service.js';
import { ActionBusyError, ScanRefusedError } from './skills/service.js';
import { CronInputError } from './crons/service.js';
import { NotFoundError, ValidationError } from './workspaces/service.js';

export interface AppDeps {
  config: AppConfig;
  db: Db;
  auth: Auth;
  store: InstanceStore;
  compat: CompatService;
  services: Services;
  fetchImpl?: FetchLike;
  /** Kanban live events (tests inject fake-hermes' factory; default: Node's WebSocket). */
  wsFactory?: WsFactory;
  /** Delay before an unanswered kanban WebSocket handshake is given up (tests shorten it). */
  wsOpenTimeoutMs?: number;
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
    if (err instanceof CronInputError) return c.json({ error: err.message, field: err.field, detail: err.detail }, 400);
    if (err instanceof ScanRefusedError) return c.json({ error: err.message, code: err.code, scan: err.scan }, 409);
    if (err instanceof ActionBusyError) return c.json({ error: err.message, code: err.code, action: err.action }, 409);
    if (err instanceof KanbanError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof AgentConflictError) return c.json({ error: err.message, code: err.code }, 409);
    if (err instanceof ConfigInputError) return c.json({ ...err.extra, error: err.message, code: err.code }, 400);
    if (err instanceof ConfigConflictError) return c.json({ error: err.message, code: err.code }, 409);
    if (err instanceof ConfirmRequiredError) {
      return c.json({ error: err.message, code: err.code, message: err.prompt, ...(err.task ? { task: err.task } : {}) }, 409);
    }
    if (err instanceof PartialWriteError) return c.json({ error: err.message, code: err.code }, 502);
    if (err instanceof DeclarativeError) return c.json({ error: err.message, code: 'declarative' }, 409);
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
    instances: store.list().map((i) => InstanceStore.toPublic(i, store.declarative ? 'env' : 'db', compat.get(i.id)?.files ?? null)),
  }));

  /** Tests a connection without saving: full compatibility check against the given settings. */
  priv.post('/instances/test', async (c) => {
    const inst = InstanceConfigSchema.parse(await c.req.json());
    const http = new HermesHttp(inst, deps.fetchImpl);
    const { report } = await checkInstance(http);
    return c.json(await withFilesRoot(http, report));
  });

  priv.post('/instances', async (c) => {
    const inst = InstanceConfigSchema.parse(await c.req.json());
    const { report } = await checkInstance(new HermesHttp(inst, deps.fetchImpl));
    if (!report.api.reachable) return c.json({ error: `API server injoignable : ${report.api.error ?? '?'}`, report }, 422);
    store.save(inst);
    const saved = await compat.check(inst.id);
    // share_file: put into Hermes right away when nothing named `intendia` is there (no test, no restart)
    const link = deps.services.mcpLink;
    try {
      if (await link.state(inst.id) === 'missing') await link.connect(inst.id, { test: false });
    } catch (err) {
      console.warn(`[intendia] MCP entry not written for ${inst.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return c.json({ instance: InstanceStore.toPublic(inst, 'db', saved.files ?? null), report: saved, mcp: { state: await link.state(inst.id) } });
  });

  /** Display name only: the id stays the key of every table, URL and MCP token. */
  priv.patch('/instances/:id', async (c) => {
    const { label } = z.object({ label: z.string().trim().min(1).max(80) }).parse(await c.req.json());
    const saved = store.rename(c.req.param('id'), label);
    if (!saved) return c.json({ error: `Instance inconnue : ${c.req.param('id')}` }, 404);
    return c.json({ instance: InstanceStore.toPublic(saved, 'db', compat.get(saved.id)?.files ?? null) });
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

  /** share_file connection details for one instance (URL, bearer token for the manual setup). */
  const mcpInfo = (id: string) => ({ url: mcpUrl(config, id), token: mcpToken(deps.db, id), publicUrlSet: Boolean(config.publicUrl) });
  priv.get('/instances/:id/mcp', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'instance inconnue' }, 404);
    return c.json({ ...mcpInfo(id), state: await deps.services.mcpLink.state(id) });
  });
  /** Writes the share_file entry into Hermes, then Hermes tests it. */
  priv.post('/instances/:id/mcp/connect', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'instance inconnue' }, 404);
    const body = z.object({ replaceOther: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await deps.services.mcpLink.connect(id, { replaceOther: body.replaceOther, test: true }));
  });
  priv.post('/instances/:id/mcp/rotate', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'instance inconnue' }, 404);
    const res = await deps.services.mcpLink.rotate(id);
    return c.json({ ...mcpInfo(id), ...res });
  });

  const { workspaces, files, links } = deps.services;
  priv.route('/', workspaceRoutes({ ...deps, workspaces }));
  priv.route('/', chatRoutes({ ...deps, workspaces }));
  priv.route('/', fileRoutes(files, deps.services.instanceFiles));
  priv.route('/', linkRoutes(links));
  priv.route('/', cronRoutes(deps.services.crons));
  priv.route('/', skillRoutes(deps.services.skills));
  priv.route('/', configRoutes(deps.services.config, deps.services.providers));
  priv.route('/', agentRoutes(deps.services.agents));
  priv.route('/', activityRoutes(deps.services.activity));
  priv.route('/', kanbanRoutes({ kanban: deps.services.kanban, config: deps.services.config, compat: deps.compat, wsFactory: deps.wsFactory, wsOpenTimeoutMs: deps.wsOpenTimeoutMs }));

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
