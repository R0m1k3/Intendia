import { Hono } from 'hono';
import { basename } from 'node:path';
import { z } from 'zod';
import type { Auth } from '../auth/auth.js';
import { RateLimiter } from '../auth/limiter.js';
import { errorPage, sendFile } from '../files/send.js';
import { LinkError, type LinkService } from '../links/service.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import { msg } from '../i18n/index.js';
import { readJson } from './body.js';

const Patch = z.object({ publicUntil: z.number().int().nullable() });

/** /x/links* (authenticated by the caller). */
export function linkRoutes(links: LinkService): Hono {
  const r = new Hono();
  r.get('/links', async (c) => c.json({ links: await links.list() }));
  r.patch('/links/:token', async (c) => {
    const { publicUntil } = Patch.parse(await readJson(c));
    try {
      const row = links.setPublic(c.req.param('token'), publicUntil);
      return c.json({ link: links.toPublic(row, (await links.existsMany([row])).get(row.token) ?? false) });
    } catch (err) {
      if (err instanceof LinkError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });
  r.delete('/links/:token', (c) => {
    links.revoke(c.req.param('token'));
    return c.json({ ok: true });
  });
  return r;
}

/** Requests per minute and per address on /f/:token without a session. */
const PUBLIC_PER_MINUTE = 60;

/**
 * GET /f/:token, outside /x. Order: unknown or revoked → 404; logged in → the file; private → login
 * (then back here); public expired → 410; public → the file. A missing file comes last, and its old
 * path is only shown to a logged-in user.
 */
export function publicLinkRoute(links: LinkService, auth: Auth, limiter = new RateLimiter(PUBLIC_PER_MINUTE, 60_000)): Hono {
  const r = new Hono();
  r.get('/f/:token', async (c) => {
    const token = c.req.param('token');
    const loggedIn = auth.isAuthenticated(c);
    // a visitor: each request reads the database, then a file at Hermes
    if (!loggedIn && !limiter.hit(auth.clientIp(c))) return errorPage(c, 429, msg('Trop de demandes'), msg('Réessayez dans une minute.'));
    const row = links.get(token);
    if (!row) return errorPage(c, 404, msg('Lien inconnu'));
    if (row.revoked) return errorPage(c, 404, msg('Lien révoqué'), msg('Ce lien a été révoqué par son propriétaire.'));
    if (!loggedIn) {
      if (row.publicUntil === null) return c.redirect(`/connexion?suite=/f/${token}`, 302);
      if (row.publicUntil <= Date.now()) return errorPage(c, 410, msg('Lien expiré'), msg('Ce lien public a expiré.'));
    }
    const unreachable = () => errorPage(c, 502, msg('Hermes injoignable'), msg('Le fichier est gardé par Hermes, qui ne répond pas. Réessayez dans un moment.'));
    try {
      const found = await links.fileFor(row);
      if (!found) {
        const oldPath = loggedIn ? links.agentPath(row.instanceId, row.path) : null;
        return errorPage(c, 404, msg('Fichier introuvable'), oldPath ? msg('Il n’est plus à {path} : il a peut-être été déplacé ou supprimé.', { path: oldPath }) : undefined);
      }
      const file = await found.fs.read(found.vol, { signal: c.req.raw.signal });
      return sendFile(c, file, basename(row.path), { download: c.req.query('download') === '1' });
    } catch (err) {
      if (err instanceof WorkspaceFsError && err.code === 'unreachable') return unreachable();
      if (err instanceof WorkspaceFsError && err.code === 'not_found') return errorPage(c, 404, msg('Fichier introuvable'));
      throw err;
    }
  });
  return r;
}
