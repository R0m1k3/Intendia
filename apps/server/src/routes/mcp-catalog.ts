import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { RateLimiter } from '../auth/limiter.js';
import { CALLBACK_PARAM_MAX, ENV_VALUE_MAX, MCP_NAME_RE, type McpCatalogService } from '../hermes-config/mcp-catalog.js';
import { ValidationError } from '../workspaces/service.js';
import { profileOf } from './skills.js';
import { msg, requestLang, toLang, type Lang } from '../i18n/index.js';

const InstallBody = z.object({ env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(ENV_VALUE_MAX)).default({}) });
const FLOW_ID = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

const name = (c: Context) => {
  const n = c.req.param('name') ?? '';
  if (!MCP_NAME_RE.test(n)) throw new ValidationError(msg('Nom de serveur MCP invalide'));
  return n;
};

/** MCP catalog and OAuth connection (Configuration › MCP), per profile. */
export function mcpCatalogRoutes(mcp: McpCatalogService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  r.get('/i/:inst/config/mcp/catalog', async (c) => c.json(await mcp.catalog(inst(c), profileOf(c))));
  r.post('/i/:inst/config/mcp/catalog/:name', async (c) => {
    const body = InstallBody.parse(await c.req.json().catch(() => ({})));
    return c.json(await mcp.install(inst(c), profileOf(c), name(c), body.env), 201);
  });
  r.post('/i/:inst/config/mcp/:name/connect', async (c) => c.json(await mcp.connect(inst(c), profileOf(c), name(c))));
  r.get('/i/:inst/config/mcp/flows/:id', async (c) => c.json(await mcp.flow(inst(c), profileOf(c), FLOW_ID.parse(c.req.param('id')))));
  r.delete('/i/:inst/config/mcp/flows/:id', async (c) => c.json(await mcp.cancel(inst(c), profileOf(c), FLOW_ID.parse(c.req.param('id')))));
  return r;
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const page = (lang: Lang, title: string, text: string) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${toLang(title, lang)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1d1d1f}h1{font-size:1.25rem}p{color:#555;line-height:1.5}</style></head>
<body><h1>${toLang(title, lang)}</h1><p>${toLang(text, lang)}</p></body></html>`;
const PAGES = {
  ok: [200, msg('Connexion terminée'), msg('Hermes a reçu l’autorisation. Vous pouvez fermer cet onglet et revenir à Intendia.')],
  failed: [502, msg('Échec de la connexion'), msg('Hermes a refusé ce retour ou ne répond pas. Revenez à Intendia pour voir l’erreur et recommencer.')],
  unknown: [404, msg('Connexion inconnue ou expirée'), msg('Aucune connexion lancée par Intendia n’attend ce retour. Recommencez depuis Intendia.')],
  invalid: [400, msg('Retour invalide'), msg('Ce lien de retour est incomplet. Recommencez depuis Intendia.')],
  limited: [429, msg('Trop de tentatives'), msg('Patientez une minute avant de réessayer.')],
} as const;

/**
 * Public return route of the MCP OAuth (no Intendia session: the provider sends the browser here). Only a callback
 * for a flow Intendia started itself is passed on (`takeExpected`), so it is not an open relay; code and state are
 * never logged. The answer is a fixed page of Intendia, never Hermes' HTML.
 */
export function mcpOauthRoutes(mcp: McpCatalogService, limiter: RateLimiter, clientIp: (c: Context) => string): Hono {
  const r = new Hono();
  const send = (c: Context, key: keyof typeof PAGES) => {
    const [status, title, text] = PAGES[key];
    return c.body(page(requestLang(c), title, text), status, PAGE_HEADERS);
  };
  r.get('/mcp-oauth/:inst/:name/callback', async (c) => {
    if (!limiter.hit(clientIp(c))) return send(c, 'limited');
    const n = c.req.param('name');
    const q = c.req.query();
    const ok = (v: string | undefined) => v === undefined || v.length <= CALLBACK_PARAM_MAX;
    if (!MCP_NAME_RE.test(n) || !q.state || !(q.code || q.error) || ![q.code, q.state, q.error, q.iss].every(ok)) return send(c, 'invalid');
    const out = await mcp.relay(c.req.param('inst'), n, { code: q.code, state: q.state, error: q.error, iss: q.iss });
    console.log(`[mcp-oauth] callback ${n}: ${out}`);
    return send(c, out);
  });
  return r;
}
