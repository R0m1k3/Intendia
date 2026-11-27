import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { msg } from '../i18n/index.js';

/** Largest JSON body of the API: the raw YAML of a configuration (2 M characters) fits, a file does not. */
export const JSON_MAX_BYTES = 4 * 1024 * 1024;

/** A request body that is not JSON: answered 400 with a fixed text, never logged. */
export class BodyError extends Error {
  readonly code = 'invalid_body';
  constructor() {
    super(msg('Corps illisible'));
  }
}

/**
 * The body as JSON. `c.req.json()` throws a SyntaxError that quotes part of the text (a password, a key), which the
 * generic journal line of `app.onError` would write to the logs: a body that does not parse gives a fixed error.
 * A read cut by the size limit is left alone (the limit answers 413).
 */
export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError();
  }
}

/**
 * Size limit of every request body under /x, but the routes that carry a file and have their own limit
 * (`skip`: upload of a file, import of a session).
 */
export function jsonBodyLimit(skip: (path: string) => boolean): MiddlewareHandler {
  const limit = bodyLimit({ maxSize: JSON_MAX_BYTES, onError: (c) => c.json({ error: msg('Requête trop grosse'), code: 'too_large' }, 413) });
  return async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || skip(c.req.path)) return next();
    return limit(c, next);
  };
}
