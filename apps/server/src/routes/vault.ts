import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AdminError } from '../admin-error.js';
import { parseVaultInput } from '../vault/input.js';
import type { VaultService } from '../vault/service.js';
import { profileOf } from './skills.js';

const MAX_BODY = 16 * 1024;

/**
 * The body as JSON. `c.req.json()` would throw a SyntaxError quoting part of the text (a password) into the generic
 * `console.error` of `app.onError`: any failure here gives a fixed error.
 */
async function bodyOf(c: Context): Promise<unknown> {
  try {
    return JSON.parse(await c.req.text()) as unknown;
  } catch {
    throw new AdminError('invalid_field', 'Corps illisible');
  }
}

/** Credential vault of a profile (`?profile=`, default `default`): logins, cards, addresses. Never cached. */
export function vaultRoutes(vault: VaultService): Hono {
  const r = new Hono();
  r.use('/i/:inst/vault/*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });
  r.use('/i/:inst/vault', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });
  const limit = bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'Requête trop grosse' }, 413) });
  const inst = (c: Context) => c.req.param('inst') ?? '';

  r.get('/i/:inst/vault', async (c) => c.json(await vault.list(inst(c), profileOf(c))));
  r.post('/i/:inst/vault', limit, async (c) => {
    const input = parseVaultInput(await bodyOf(c));
    return c.json(await vault.add(inst(c), profileOf(c), input), 201);
  });
  r.post('/i/:inst/vault/:id/replace', limit, async (c) => {
    const input = parseVaultInput(await bodyOf(c));
    return c.json(await vault.replace(inst(c), profileOf(c), c.req.param('id'), input));
  });
  r.delete('/i/:inst/vault/:id', async (c) => {
    await vault.remove(inst(c), profileOf(c), c.req.param('id'));
    return c.body(null, 204);
  });
  return r;
}
