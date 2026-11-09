import { Hono } from 'hono';
import { basename } from 'node:path';
import { z } from 'zod';
import type { Auth } from '../auth/auth.js';
import { errorPage, sendFile } from '../files/send.js';
import { LinkError, type LinkService } from '../links/service.js';

const Patch = z.object({ publicUntil: z.number().int().nullable() });

/** /x/links* (authenticated by the caller). */
export function linkRoutes(links: LinkService): Hono {
  const r = new Hono();
  r.get('/links', (c) => c.json({ links: links.list() }));
  r.patch('/links/:token', async (c) => {
    const { publicUntil } = Patch.parse(await c.req.json());
    try {
      return c.json({ link: links.toPublic(links.setPublic(c.req.param('token'), publicUntil)) });
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

/**
 * GET /f/:token, outside /x. Order: unknown or revoked → 404; logged in → the file; private → login
 * (then back here); public expired → 410; public → the file. A missing file comes last, and its old
 * path is only shown to a logged-in user.
 */
export function publicLinkRoute(links: LinkService, auth: Auth): Hono {
  const r = new Hono();
  r.get('/f/:token', (c) => {
    const token = c.req.param('token');
    const row = links.get(token);
    if (!row) return errorPage(c, 404, 'Lien inconnu');
    if (row.revoked) return errorPage(c, 404, 'Lien révoqué', 'Ce lien a été révoqué par son propriétaire.');
    const loggedIn = auth.isAuthenticated(c);
    if (!loggedIn) {
      if (row.publicUntil === null) return c.redirect(`/connexion?suite=/f/${token}`, 302);
      if (row.publicUntil <= Date.now()) return errorPage(c, 410, 'Lien expiré', 'Ce lien public a expiré.');
    }
    const abs = links.fileFor(row);
    if (!abs) {
      const oldPath = loggedIn ? links.toPublic(row).agentPath : null;
      return errorPage(c, 404, 'Fichier introuvable', oldPath ? `Il n’est plus à ${oldPath} : il a peut-être été déplacé ou supprimé.` : undefined);
    }
    return sendFile(c, abs, basename(row.path), { download: c.req.query('download') === '1' });
  });
  return r;
}
