import { goalRoutes } from './routes/goal.js';
import { channelRoutes } from './routes/channels.js';
import { msg, translateResponses } from './i18n/index.js';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { InstanceConfigSchema, type AppConfig, type InstanceConfig } from './config.js';
import { Auth, AuthError, requireAuth } from './auth/auth.js';
import type { CompatService } from './compat/service.js';
import { checkInstance } from './compat/engine.js';
import { withFilesRoot } from './compat/files-root.js';
import type { Db } from './db/index.js';
import { HermesError, HermesHttp, type FetchLike } from './hermes/http.js';
import { KeyedLock } from './keyed-lock.js';
import { changedFields, DeclarativeError, InstanceEditError, InstanceStore, mergeInstance, type InstancePatch } from './instances/store.js';
import type { CompatReport } from './connectors/types.js';
import { ModuleUnavailableError } from './connectors/runtime.js';
import { forgetMcpToken, forgetPreviousMcpToken, mcpToken, mcpUrl } from './mcp/server.js';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { gitRoutes } from './routes/git.js';
import { GitError } from './git/service.js';
import { AdminError } from './admin-error.js';
import { Masker, SecretError } from './hermes-config/mask.js';
import { CODE_MESSAGE, hermesErrorResponse } from './connectors/errors.js';
import { memoryRoutes } from './routes/memory.js';
import { vaultRoutes } from './routes/vault.js';
import { pluginRoutes } from './routes/plugins.js';
import { mcpCatalogRoutes, mcpOauthRoutes } from './routes/mcp-catalog.js';
import { RateLimiter } from './auth/limiter.js';
import { monitorRoutes } from './routes/monitor.js';
import { linkRoutes, publicLinkRoute } from './routes/links.js';
import type { Services } from './services.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { sessionCopyRoutes } from './routes/session-copies.js';
import { CopyError } from './sessions/copy.js';
import { TitleError } from './sessions/title-ai.js';
import { FS_ERROR_STATUS, WorkspaceFsError } from './workspaces/fs.js';
import { PromptService } from './prompts/service.js';
import { promptRoutes } from './routes/prompts.js';
import { ARCHIVE_CODE, ARCHIVE_STATUS, ArchiveError } from './files/archive.js';
import { cronRoutes } from './routes/crons.js';
import { skillRoutes } from './routes/skills.js';
import { agentRoutes } from './routes/agents.js';
import { activityRoutes } from './routes/activity.js';
import { kanbanRoutes } from './routes/kanban.js';
import type { WsFactory } from './connectors/kanban/index.js';
import { AgentConflictError } from './agents/service.js';
import { KanbanError } from './kanban/service.js';
import { configRoutes } from './routes/config.js';
import { ConfigConflictError, ConfigInputError, ConfigNotAppliedError, ConfirmRequiredError, PartialWriteError } from './hermes-config/service.js';
import { ActionBusyError, ScanRefusedError } from './skills/service.js';
import { CronInputError } from './crons/service.js';
import { NotFoundError, ValidationError } from './workspaces/service.js';
import { BodyError, jsonBodyLimit, readJson } from './routes/body.js';

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
  /** Life of one kanban live relay before it is renewed (default 10 min; tests shorten it). */
  kanbanRelayMaxMs?: number;
  version: string;
}

const PasswordBody = z.object({ password: z.string().min(1).max(1024) });
/** PATCH /x/instances/:id (and its test): every field optional, empty = unchanged, null = removed. */
const PatchBody = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  api: z.string().max(2000).optional(),
  apiKey: z.string().max(4096).optional(),
  dashboard: z.string().max(2000).nullable().optional(),
  dashboardToken: z.string().max(4096).optional(),
  dashboardLink: z.string().max(2000).nullable().optional(),
  profileKeys: z.record(z.string().min(1).max(64), z.string().min(16).max(4096).nullable()).optional(),
});
const SetupBody = z.object({ code: z.string().min(1).max(64), password: z.string().min(1).max(1024) });

export function createApp(deps: AppDeps) {
  const { auth, store, compat, config } = deps;
  const app = new Hono();
  // Hermes' own error details reach the browser: generic secrets masked, then the exact secrets of the instances
  const masker = new Masker(config.secret);
  const mask = (text: string) => masker.known(masker.text(text), store.list().flatMap((i) => [
    i.apiKey, ...(i.dashboardToken ? [i.dashboardToken] : []), ...Object.values(i.profileKeys ?? {}),
  ]));

  // first: sees the final answer of every route and of onError
  app.use('*', translateResponses());
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    // only over https (the proxy's X-Forwarded-Proto): a browser ignores it over http, and a LAN address stays usable
    if (auth.isSecure(c)) c.header('Strict-Transport-Security', 'max-age=2592000');
    // file routes allow framing by Intendia itself (preview); every other response stays DENY
    if (!c.res.headers.has('X-Frame-Options')) c.header('X-Frame-Options', 'DENY');
  });

  app.onError((err, c) => {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    if (err instanceof BodyError) return c.json({ error: err.message, code: err.code }, 400);
    if (err instanceof z.ZodError) return c.json({ error: msg('Requête invalide'), issues: err.issues }, 400);
    if (err instanceof CronInputError) return c.json({ error: err.message, field: err.field, detail: err.detail }, 400);
    if (err instanceof ScanRefusedError) return c.json({ error: err.message, code: err.code, scan: err.scan }, 409);
    if (err instanceof ActionBusyError) return c.json({ error: err.message, code: err.code, action: err.action }, 409);
    if (err instanceof KanbanError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof AgentConflictError) return c.json({ error: err.message, code: err.code }, 409);
    if (err instanceof ConfigInputError) return c.json({ ...err.extra, error: err.message, code: err.code }, 400);
    if (err instanceof ConfigConflictError) return c.json({ error: err.message, code: err.code }, 409);
    if (err instanceof ConfigNotAppliedError) return c.json({ error: err.message, code: err.code, ...(err.paths ? { paths: err.paths } : {}) }, 409);
    if (err instanceof ConfirmRequiredError) {
      return c.json({ error: err.message, code: err.code, message: err.prompt, ...(err.task ? { task: err.task } : {}) }, 409);
    }
    if (err instanceof PartialWriteError) return c.json({ error: err.message, code: err.code }, 502);
    if (err instanceof DeclarativeError) return c.json({ error: err.message, code: 'declarative' }, 409);
    if (err instanceof InstanceEditError) return c.json({ error: err.message, code: err.code, field: err.field }, 400);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof CopyError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof TitleError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof GitError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof SecretError) return c.json({ ...err.extra, error: err.message, code: err.code }, 400);
    if (err instanceof AdminError) return c.json({ ...err.extra, error: err.message, code: err.code }, err.status);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ArchiveError) return c.json({ error: err.message, code: ARCHIVE_CODE[err.code] }, ARCHIVE_STATUS[err.code]);
    if (err instanceof WorkspaceFsError) {
      return c.json({ error: err.message, code: err.code }, FS_ERROR_STATUS[err.code]);
    }
    if (err instanceof ModuleUnavailableError) {
      const body = { error: err.message, module: err.module, op: err.op, reasons: err.reasons };
      if (!err.code) return c.json(body, 409);
      return c.json({ ...body, error: CODE_MESSAGE[err.code], code: err.code }, err.code === 'hermes_unreachable' ? 504 : 409);
    }
    if (err instanceof HermesError) {
      const r = hermesErrorResponse(err, mask);
      for (const [k, v] of Object.entries(r.headers ?? {})) c.header(k, v);
      return c.json(r.body, r.status);
    }
    console.error(err);
    return c.json({ error: msg('Erreur interne du serveur Intendia (voir ses journaux)') }, 500);
  });

  const x = new Hono();

  // ---- public: health, first-run state, login
  // the database answers too: a server that listens with a broken or locked database is not healthy
  x.get('/health', (c) => {
    try {
      deps.db.$client.prepare('SELECT 1').get();
    } catch {
      return c.json({ ok: false, version: deps.version }, 503);
    }
    return c.json({ ok: true, version: deps.version });
  });
  // bodies are JSON and small; a file goes through its own route, with its own limit
  x.use('*', jsonBodyLimit((path) => path.endsWith('/upload') || path.endsWith('/sessions/import')));

  x.get('/setup', (c) => c.json({
    needsPassword: auth.needsPassword(),
    needsInstance: store.list().length === 0,
    declarativeInstances: store.declarative,
    authenticated: auth.isAuthenticated(c),
    version: deps.version,
  }));

  x.post('/setup/password', async (c) => {
    auth.rateLimit(auth.clientIp(c));
    const body = SetupBody.parse(await readJson(c));
    await auth.setInitialPassword(body.code, body.password);
    auth.createSession(c);
    return c.json({ ok: true });
  });

  x.post('/login', async (c) => {
    auth.rateLimit(auth.clientIp(c));
    const { password } = PasswordBody.parse(await readJson(c));
    if (!(await auth.checkPassword(password))) return c.json({ error: msg('Mot de passe incorrect') }, 401);
    auth.createSession(c);
    return c.json({ ok: true });
  });

  // public: the OAuth provider sends the browser back here (MCP catalog, lot 8 E2)
  x.route('/', mcpOauthRoutes(deps.services.mcpCatalog, new RateLimiter(10, 60_000), (c) => auth.clientIp(c)));

  x.post('/logout', (c) => {
    auth.destroySession(c);
    return c.json({ ok: true });
  });

  // ---- authenticated
  const priv = new Hono();
  priv.use('*', requireAuth(auth));

  priv.post('/auth/revoke-all', (c) => {
    auth.revokeAll(c);
    return c.json({ ok: true });
  });
  priv.get('/instances', (c) => c.json({
    declarative: store.declarative,
    instances: store.list().map((i) => InstanceStore.toPublic(i, store.declarative ? 'env' : 'db', compat.get(i.id)?.files ?? null)),
  }));

  /** Tests a connection without saving: full compatibility check against the given settings. */
  priv.post('/instances/test', async (c) => c.json(await testConfig(InstanceConfigSchema.parse(await readJson(c)))));

  /** Runs a full check of a config that is not saved (no observer: the report is the answer). */
  const testConfig = async (inst: InstanceConfig) => {
    const http = new HermesHttp(inst, deps.fetchImpl);
    const { report } = await checkInstance(http);
    return withFilesRoot(http, report);
  };
  /** 422 body when Hermes cannot be reached with this API key, or refuses it; null when the key works. */
  const apiRefusal = (report: CompatReport) => {
    if (report.api.auth === 'refused') return { error: msg('Hermes refuse la clé de l’API server : {error}', { error: report.api.error ?? '?' }), code: 'api_key_refused', report };
    if (!report.api.reachable) return { error: msg('API server injoignable : {error}', { error: report.api.error ?? '?' }), report };
    return null;
  };
  const unknownInstance = (id: string) => ({ error: msg('Instance inconnue : {id}', { id }) });
  /** share_file: put into Hermes right away when nothing named `intendia` is there (no test, no restart). */
  const linkMcp = async (id: string) => {
    const link = deps.services.mcpLink;
    try {
      if (await link.state(id) === 'missing') await link.connect(id, { test: false });
    } catch (err) {
      console.warn(`[intendia] MCP entry not written for ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /**
   * Writes to one instance run one at a time: an edit merges against the saved config, waits for Hermes, then saves the
   * whole snapshot, so two overlapping edits (or an edit and a delete) would silently undo each other.
   */
  const instanceWrites = new KeyedLock();

  priv.post('/instances', async (c) => {
    const inst = InstanceConfigSchema.parse(await readJson(c));
    if (store.declarative) throw new DeclarativeError();
    return instanceWrites.run(inst.id, async () => {
      // a saved instance is changed with PATCH: an overwrite would silently drop a secret left out
      if (store.get(inst.id)) {
        return c.json({ error: msg('Une instance « {id} » existe déjà : utilisez Modifier', { id: inst.id }), code: 'instance_exists' }, 409);
      }
      const { report } = await checkInstance(new HermesHttp(inst, deps.fetchImpl));
      const refused = apiRefusal(report);
      if (refused) return c.json(refused, 422);
      store.save(inst);
      const saved = await compat.check(inst.id);
      await linkMcp(inst.id);
      return c.json({ instance: InstanceStore.toPublic(inst, 'db', saved.files ?? null), report: saved, mcp: { state: await deps.services.mcpLink.state(inst.id) } });
    });
  });

  /** Merges a PATCH body into the saved instance (404 unknown, 400 secret required or invalid result). */
  const merged = (id: string, patch: InstancePatch): InstanceConfig | null => {
    const current = store.get(id);
    if (!current) return null;
    return InstanceConfigSchema.parse(mergeInstance(current, patch));
  };

  /** Tests the saved instance with the changes of a PATCH body, without saving (the browser has no secret). */
  priv.post('/instances/:id/test', async (c) => {
    const id = c.req.param('id');
    const next = merged(id, PatchBody.parse(await readJson(c)));
    if (!next) return c.json(unknownInstance(id), 404);
    return c.json(await testConfig(next));
  });

  /**
   * Edits an instance: name, addresses, API key, dashboard token, profile keys. The id stays the key of every table,
   * URL and MCP token (never touched). Name only: no check. Otherwise the merged settings are checked, saved, then
   * checked again by the compatibility service (a check started after the save).
   */
  priv.patch('/instances/:id', async (c) => {
    const id = c.req.param('id');
    const body = PatchBody.parse(await readJson(c));
    if (store.declarative) throw new DeclarativeError();
    return instanceWrites.run(id, async () => {
      const current = store.get(id);
      if (!current) return c.json(unknownInstance(id), 404);
      const next = InstanceConfigSchema.parse(mergeInstance(current, body));
      const changed = changedFields(current, next);
      if (changed.every((k) => k === 'label')) {
        const saved = changed.length > 0 ? store.rename(id, next.label)! : current;
        return c.json({ instance: InstanceStore.toPublic(saved, 'db', compat.get(id)?.files ?? null), report: compat.get(id) ?? null });
      }
      const { report } = await checkInstance(new HermesHttp(next, deps.fetchImpl));
      // only a change of the API side needs a working API: a dashboard token can be fixed while the API is down
      if (changed.some((k) => k === 'api' || k === 'apiKey' || k === 'profileKeys')) {
        const refused = apiRefusal(report);
        if (refused) return c.json(refused, 422);
      }
      store.save(next);
      const saved = await compat.check(id);
      if (changed.includes('api')) await linkMcp(id);
      return c.json({ instance: InstanceStore.toPublic(next, 'db', saved.files ?? null), report: saved, mcp: { state: await deps.services.mcpLink.state(id) } });
    });
  });

  priv.delete('/instances/:id', (c) => {
    const id = c.req.param('id');
    return instanceWrites.run(id, async () => {
      store.remove(id);
      forgetMcpToken(deps.db, id);
      compat.forget(id);
      return c.json({ ok: true });
    });
  });

  priv.get('/compat', (c) => c.json({ reports: compat.all() }));

  priv.post('/compat/:id/check', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: msg('instance inconnue') }, 404);
    return c.json(await compat.check(id));
  });

  /** share_file connection details for one instance (URL, bearer token for the manual setup). */
  const mcpInfo = (id: string) => ({ url: mcpUrl(config, id), token: mcpToken(deps.db, id), publicUrlSet: Boolean(config.publicUrl) });
  priv.get('/instances/:id/mcp', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: msg('instance inconnue') }, 404);
    return c.json({ ...mcpInfo(id), state: await deps.services.mcpLink.state(id) });
  });
  /** Writes the share_file entry into Hermes, then Hermes tests it. */
  priv.post('/instances/:id/mcp/connect', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: msg('instance inconnue') }, 404);
    const body = z.object({ replaceOther: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await deps.services.mcpLink.connect(id, { replaceOther: body.replaceOther, test: true }));
  });
  priv.post('/instances/:id/mcp/rotate', async (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: msg('instance inconnue') }, 404);
    const res = await deps.services.mcpLink.rotate(id);
    return c.json({ ...mcpInfo(id), ...res });
  });
  /** Ends the 24 h grace of the token before the last rotation (a leaked token). */
  priv.post('/instances/:id/mcp/revoke-previous', (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: msg('instance inconnue') }, 404);
    forgetPreviousMcpToken(deps.db, id);
    return c.json({ ok: true });
  });

  const { workspaces, files, links } = deps.services;
  priv.route('/', workspaceRoutes({ ...deps, workspaces }));
  priv.route('/', chatRoutes({ ...deps, workspaces }));
  priv.route('/', goalRoutes(deps.services.runDeps));
  priv.route('/', channelRoutes({ channels: deps.services.channels, runner: deps.services.channelRunner, store: deps.store }));
  priv.route('/', sessionCopyRoutes({ ...deps, workspaces }));
  priv.route('/', fileRoutes(files, deps.services.instanceFiles));
  priv.route('/', gitRoutes(deps.services.git));
  priv.route('/', linkRoutes(links));
  priv.route('/', promptRoutes(new PromptService(deps.db)));
  priv.route('/', cronRoutes(deps.services.crons));
  priv.route('/', skillRoutes(deps.services.skills));
  priv.route('/', configRoutes(deps.services.config, deps.services.providers));
  priv.route('/', agentRoutes(deps.services.agents));
  priv.route('/', activityRoutes({ activity: deps.services.activity, workspaces: deps.services.workspaces, store: deps.store }));
  priv.route('/', monitorRoutes(deps.services.monitor));
  priv.route('/', memoryRoutes(deps.services.memory));
  priv.route('/', vaultRoutes(deps.services.vault));
  priv.route('/', pluginRoutes(deps.services.plugins));
  priv.route('/', mcpCatalogRoutes(deps.services.mcpCatalog));
  priv.route('/', kanbanRoutes({ kanban: deps.services.kanban, missions: deps.services.missions, config: deps.services.config, compat: deps.compat, wsFactory: deps.wsFactory, wsOpenTimeoutMs: deps.wsOpenTimeoutMs, kanbanRelayMaxMs: deps.kanbanRelayMaxMs }));

  x.route('/', priv);
  app.route('/x', x);
  app.route('/', publicLinkRoute(links, auth));

  // ---- SPA
  const webDir = config.webDir;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8');
    app.use('/assets/*', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
    app.use('/favicon.svg', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
    app.use('/apple-touch-icon.png', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
    app.get('*', (c) => {
      if (c.req.path.startsWith('/x/') || c.req.path.startsWith('/f/')) return c.json({ error: 'not found' }, 404);
      // the app's pages may be framed by the app itself (side chat, ⌘J); API and file responses keep their own rules.
      // frame-src: a frame of the app (an artefact's scripts) can never navigate itself to another site
      c.header('X-Frame-Options', 'SAMEORIGIN');
      // script-src: only the app's own files run (no inline script, no other site); blob: for the viewers' workers
      c.header('Content-Security-Policy', "frame-ancestors 'self'; frame-src 'self'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'");
      return c.html(indexHtml);
    });
  }

  return app;
}
