// MCP catalog and dashboard OAuth of Hermes 0.23 (`/api/mcp/catalog*`, `/api/mcp/servers/{name}/auth`,
// `/api/mcp/oauth/flows/{flow_id}`, public `/api/mcp/oauth/callback/{server_name}`), on top of the fake's config file.
import { randomBytes } from 'node:crypto';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** `notes-cloud`: OAuth, nothing to fill; `taches-pro`: OAuth with its own app (client id + secret); `docs-libres`: no auth. */
export const FAKE_MCP_CATALOG = [
  { name: 'notes-cloud', description: 'Notes et carnets de votre espace Notes Cloud.', source: 'https://notes.example.test/docs/mcp', auth_type: 'oauth', url: 'https://mcp.notes.example.test/mcp', env: [], post_install: 'Au premier usage, autorisez Notes Cloud dans le navigateur.' },
  {
    name: 'taches-pro', description: 'Tâches et projets de Tâches Pro.', source: 'https://taches.example.test/mcp', auth_type: 'oauth', url: 'https://mcp.taches.example.test/v2/mcp',
    env: [{ name: 'TACHES_CLIENT_ID', prompt: 'Client ID de votre application Tâches Pro', required: true, secret: false }, { name: 'TACHES_CLIENT_SECRET', prompt: 'Secret de l’application', required: true, secret: true }],
    post_install: 'Créez une application dans la console de Tâches Pro (redirection : l’URL de retour).',
  },
  { name: 'docs-libres', description: 'Documentation publique, sans compte.', source: 'javascript:alert(1)', auth_type: 'none', url: 'https://docs.example.test/mcp', env: [], post_install: '' },
];

interface Flow { id: string; name: string; status: 'authorization_required' | 'approved' | 'error'; state: string; redirect: string; error: string | null }

export class McpCatalogFake {
  private readonly flows = new Map<string, Flow>();
  /** Callbacks received (tests): server, code, state. */
  readonly callbacks: { server: string; code: string | null; state: string | null }[] = [];

  constructor(private readonly file: () => Obj, private readonly write: (o: Obj) => void, private readonly env: Map<string, string>) {}

  private servers(): Record<string, Obj> {
    const s = this.file().mcp_servers;
    return (isObj(s) ? s : {}) as Record<string, Obj>;
  }

  private snapshot(f: Flow): Obj {
    const auth = `https://auth.example.test/authorize?client_id=fake&redirect_uri=${encodeURIComponent(f.redirect)}&state=${f.state}`;
    return { flow_id: f.id, server_name: f.name, status: f.status, authorization_url: f.status === 'authorization_required' ? auth : null, error: f.error };
  }

  handle(method: string, path: string, query: Record<string, string>, body: unknown): Response | null {
    const b = (isObj(body) ? body : {}) as Obj;
    if (method === 'GET' && path === '/api/mcp/catalog') {
      const servers = this.servers();
      return json({
        entries: FAKE_MCP_CATALOG.map((e) => ({
          name: e.name, description: e.description, connector_slug: e.name, source: e.source, transport: 'http', auth_type: e.auth_type,
          required_env: e.env.map(({ name, prompt, required }) => ({ name, prompt, required })), command: null, args: [], url: e.url,
          install_url: null, install_ref: null, bootstrap: [], default_enabled: null, post_install: e.post_install, suggest: null, needs_install: false,
          installed: e.name in servers, enabled: e.name in servers && servers[e.name]!.enabled !== false,
        })),
        diagnostics: [{ name: 'casse', kind: 'invalid', message: 'manifest casse.yaml: missing url' }],
      });
    }
    if (method === 'POST' && path === '/api/mcp/catalog/install') {
      const name = String(b.name ?? '');
      const e = FAKE_MCP_CATALOG.find((x) => x.name === name);
      if (!e) return json({ detail: `No catalog entry '${name}'` }, 404);
      const env = (isObj(b.env) ? b.env : {}) as Record<string, string>;
      const undeclared = Object.keys(env).filter((k) => !e.env.some((d) => d.name === k)).sort();
      if (undeclared.length) return json({ detail: `Catalog entry '${name}' does not declare environment variable(s): ${undeclared.join(', ')}` }, 400);
      for (const d of e.env) if (d.secret && env[d.name]) this.env.set(d.name, env[d.name]!);
      const entry: Obj = { url: e.url, enabled: b.enable !== false };
      if (e.auth_type === 'oauth') entry.auth = 'oauth';
      const clientId = e.env.find((d) => !d.secret);
      if (clientId && env[clientId.name]) entry.oauth = { client_id: env[clientId.name] };
      const file = this.file();
      this.write({ ...file, mcp_servers: { ...this.servers(), [name]: entry } });
      return json({ ok: true, name, background: false });
    }
    const auth = /^\/api\/mcp\/servers\/([^/]+)\/auth$/.exec(path);
    if (auth && method === 'POST') {
      const name = decodeURIComponent(auth[1]!);
      const cfg = this.servers()[name];
      if (!cfg) return json({ detail: `Server '${name}' not found` }, 404);
      if (!cfg.url) return json({ detail: 'stdio servers authenticate via env keys, not OAuth' }, 400);
      if (cfg.headers && cfg.auth !== 'oauth') return json({ detail: 'This server uses header/API-key auth, not OAuth' }, 400);
      if ([...this.flows.values()].some((f) => f.name === name && f.status === 'authorization_required')) {
        return json({ detail: `MCP OAuth for '${name}' is already in progress` }, 409);
      }
      const oauth = isObj(cfg.oauth) ? cfg.oauth : {};
      const f: Flow = {
        id: randomBytes(18).toString('base64url'), name, status: 'authorization_required', state: randomBytes(16).toString('base64url'),
        redirect: typeof oauth.redirect_uri === 'string' ? oauth.redirect_uri : `http://fake-dash/api/mcp/oauth/callback/${encodeURIComponent(name)}`, error: null,
      };
      this.flows.set(f.id, f);
      return json(this.snapshot(f));
    }
    const flow = /^\/api\/mcp\/oauth\/flows\/([^/]+)$/.exec(path);
    if (flow) {
      const f = this.flows.get(decodeURIComponent(flow[1]!));
      if (method === 'GET') {
        if (!f) return json({ detail: 'OAuth flow not found or expired' }, 404);
        return json({ ...this.snapshot(f), tools: f.status === 'approved' ? [{ name: `${f.name}_search` }] : [] });
      }
      if (method === 'DELETE') {
        if (!f) return json({ ok: true, status: 'expired' });
        if (f.status === 'authorization_required') { f.status = 'error'; f.error = 'Cancelled by user'; }
        return json({ ok: true, status: f.status });
      }
    }
    const cb = /^\/api\/mcp\/oauth\/callback\/(.+)$/.exec(path);
    if (cb && method === 'GET') {
      const server = decodeURIComponent(cb[1]!);
      this.callbacks.push({ server, code: query.code ?? null, state: query.state ?? null });
      const f = [...this.flows.values()].find((x) => x.name === server && x.status === 'authorization_required' && x.state === query.state);
      if (!f) return html('<h1>OAuth flow expired</h1><p>Return to Hermes and try again.</p>', 404);
      if (query.error) { f.status = 'error'; f.error = `Authorization denied: ${query.error}`; return html('<h1>Authorization failed</h1>', 400); }
      f.status = 'approved';
      return html('<h1>Authorization received</h1><p>You can close this tab and return to Hermes.</p>');
    }
    return null;
  }
}
