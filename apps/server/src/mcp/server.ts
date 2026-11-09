/**
 * MCP endpoint for the agents (port INTENDIA_MCP_PORT, never published): one tool, share_file.
 * Hand-written JSON-RPC 2.0 over Streamable HTTP, stateless, JSON responses only (no SSE): four
 * methods do not justify the official SDK and its 17 dependencies. Hermes 0.23.0 offers 2025-11-25 and
 * falls back to an older version, or to server/discover, when needed.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import { randomToken, safeEqual } from '../crypto.js';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { toVolumePath } from '../files/paths.js';
import type { InstanceStore } from '../instances/store.js';
import { NO_PUBLIC_URL_NOTE, type LinkService } from '../links/service.js';
import { WorkspaceFsError } from '../workspaces/fs.js';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const BODY_MAX_BYTES = 64 * 1024;

const key = (id: string) => `mcp_token:${id}`;

/** The bearer token of an instance, created on first read (kept in `settings`). */
export function mcpToken(db: Db, instanceId: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key(instanceId))).get();
  if (row) return row.value;
  const value = randomToken(32);
  db.insert(settings).values({ key: key(instanceId), value }).onConflictDoNothing().run();
  return db.select().from(settings).where(eq(settings.key, key(instanceId))).get()!.value;
}

export function rotateMcpToken(db: Db, instanceId: string): string {
  forgetMcpToken(db, instanceId);
  return mcpToken(db, instanceId);
}

export function forgetMcpToken(db: Db, instanceId: string): void {
  db.delete(settings).where(eq(settings.key, key(instanceId))).run();
}

/** URL to give Hermes: the Intendia service name on the shared Docker network. */
export function mcpUrl(config: Pick<AppConfig, 'mcpPort'>, instanceId: string): string {
  return `http://intendia:${config.mcpPort}/mcp/${instanceId}`;
}

const SHARE_FILE_TOOL = {
  name: 'share_file',
  description: 'Share a file from the workspace volume with the user: returns a private link to give in your answer. `path` is the absolute path of an existing file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Absolute path of the file, as you see it.' } },
    required: ['path'],
    additionalProperties: false,
  },
};

type Id = string | number | null;
const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

export interface McpDeps {
  db: Db;
  store: InstanceStore;
  links: LinkService;
  config: Pick<AppConfig, 'publicUrl' | 'mcpPort'>;
  version: string;
}

export function createMcpApp(deps: McpDeps): Hono {
  const { db, store, links, config } = deps;
  const app = new Hono();

  const shareFile = (instanceId: string, args: unknown) => {
    const path = (args as { path?: unknown } | null)?.path;
    const refuse = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
    if (typeof path !== 'string' || !path) return refuse('`path` is required (absolute path of a file).');
    const inst = store.get(instanceId)!;
    const vol = toVolumePath(path, inst);
    if (vol === null) return refuse(`Refused: ${path} is outside the shared workspace volume.`);
    try {
      const row = links.share(instanceId, vol, { forAgent: true });
      const url = links.url(row.token);
      return { content: [{ type: 'text', text: config.publicUrl ? url : `${url}\n(${NO_PUBLIC_URL_NOTE})` }] };
    } catch (err) {
      if (err instanceof WorkspaceFsError) {
        const why = err.code === 'outside' ? 'outside the shared volume' : err.code === 'not_file' ? 'not a regular file' : 'not found';
        return refuse(`Refused: ${path} is ${why}.`);
      }
      throw err;
    }
  };

  const handle = (instanceId: string, msg: unknown): object | null => {
    if (!msg || typeof msg !== 'object' || (msg as { jsonrpc?: unknown }).jsonrpc !== '2.0') return fail(null, -32600, 'Invalid Request');
    const { id, method, params } = msg as { id?: Id; method?: unknown; params?: Record<string, unknown> };
    if (id === undefined) return null; // notification
    if (typeof method !== 'string') return fail(id, -32600, 'Invalid Request');
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        const protocolVersion = typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return ok(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'intendia', version: deps.version },
          instructions: 'Call share_file with the absolute path of each delivered file and give the user the returned link.',
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: [SHARE_FILE_TOOL] });
      case 'tools/call': {
        if (params?.name !== 'share_file') return fail(id, -32602, `Unknown tool: ${String(params?.name)}`);
        return ok(id, shareFile(instanceId, params.arguments));
      }
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  };

  app.on(['GET', 'HEAD', 'DELETE'], '/mcp/:instance', (c) => c.body(null, 405, { Allow: 'POST' }));

  app.post('/mcp/:instance', async (c) => {
    const instanceId = c.req.param('instance');
    if (!store.get(instanceId)) return c.json({ error: 'unknown instance' }, 404);
    const auth = c.req.header('authorization') ?? '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!given || !safeEqual(given, mcpToken(db, instanceId))) return c.json({ error: 'unauthorized' }, 401);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > BODY_MAX_BYTES) return c.json(fail(null, -32600, 'Request too large'), 413);
    const text = await c.req.text();
    if (Buffer.byteLength(text, 'utf8') > BODY_MAX_BYTES) return c.json(fail(null, -32600, 'Request too large'), 413);
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return c.json(fail(null, -32700, 'Parse error'));
    }
    if (Array.isArray(msg)) return c.json(fail(null, -32600, 'Batches are not supported'));
    let reply: object | null;
    try {
      reply = handle(instanceId, msg);
    } catch (err) {
      console.error('[mcp]', err);
      reply = fail((msg as { id?: Id }).id ?? null, -32603, 'Internal error');
    }
    if (reply === null) return c.body(null, 202);
    return c.json(reply);
  });

  app.all('*', (c) => c.json({ error: 'not found' }, 404));
  return app;
}
