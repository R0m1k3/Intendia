/**
 * Fake Hermes: replays a probe recording (fixtures/hermes-<version>/) on two Hono apps,
 * the API server and the dashboard. Used for front-end development and CI, without Hermes
 * nor an AI provider key. `breaks` simulates an incompatible Hermes release.
 */
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FAKE_API_KEY = 'fake-api-key-000000000000';
export const FAKE_DASH_TOKEN = 'fake-dashboard-token';

export interface Break {
  /** HTTP status to answer instead of the fixture (e.g. 404, 500). */
  status?: number;
  /** Replaces the fixture body (e.g. a renamed field). */
  body?: unknown;
}

export interface FakeOptions {
  fixturesDir: string;
  /** Keyed by "api GET /path" or "dash GET /path". */
  breaks?: Record<string, Break>;
  /** Hide entries of /v1/capabilities `endpoints` or dashboard OpenAPI routes ("METHOD /path"). */
  hide?: { capabilities?: string[]; openapi?: string[] };
}

/** Must match apps/server/src/cli/fixtures.ts (checked by a server test). */
export function fixtureName(method: string, path: string): string {
  return `${method.toUpperCase()}${path.replace(/[^A-Za-z0-9]+/g, '_')}.json`;
}

type Via = 'api' | 'dash';

function load(dir: string, via: Via, method: string, path: string): { status: number; body: unknown } | null {
  const file = join(dir, via, path === '/openapi.json' ? 'openapi.json' : fixtureName(method, path));
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return path === '/openapi.json' ? { status: 200, body: raw } : raw;
}

function makeApp(via: Via, opts: FakeOptions): Hono {
  const app = new Hono();
  const token = via === 'api' ? FAKE_API_KEY : FAKE_DASH_TOKEN;
  let runCounter = 0;

  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();
    if (c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthorized' }, 401);
    return next();
  });

  app.all('*', (c) => {
    const method = c.req.method;
    const path = c.req.path;
    const key = `${via} ${method} ${path}`;
    const brk = opts.breaks?.[key];
    if (brk?.status) return c.json(brk.body ?? { error: 'broken by fake-hermes' }, brk.status as 404);
    if (brk && 'body' in brk) return c.json(brk.body as object);

    if (via === 'api' && method === 'POST' && path === '/v1/runs') {
      runCounter += 1;
      return c.json({ run_id: `run_fake_${runCounter}`, status: 'started', replayed: false });
    }

    const fx = load(opts.fixturesDir, via, method, path);
    if (fx) {
      let body = fx.body;
      if (via === 'api' && path === '/v1/capabilities' && opts.hide?.capabilities?.length) {
        const caps = structuredClone(body) as { endpoints?: Record<string, unknown> };
        for (const k of opts.hide.capabilities) delete caps.endpoints?.[k];
        body = caps;
      }
      if (via === 'dash' && path === '/openapi.json' && opts.hide?.openapi?.length) {
        const spec = structuredClone(body) as { paths: Record<string, Record<string, unknown>> };
        for (const r of opts.hide.openapi) {
          const [m, p] = [r.slice(0, r.indexOf(' ')).toLowerCase(), r.slice(r.indexOf(' ') + 1)];
          delete spec.paths[p]?.[m];
        }
        body = spec;
      }
      return c.json(body as object, fx.status as 200);
    }
    // Writes have no recording: acknowledge them so UI flows can be exercised.
    if (method !== 'GET') return c.json({ ok: true, fake: true });
    return c.json({ error: 'not recorded' }, 404);
  });
  return app;
}

export function createFakeHermes(opts: FakeOptions) {
  return { api: makeApp('api', opts), dash: makeApp('dash', opts) };
}

/**
 * fetch implementation routing http://fake-api/... and http://fake-dash/... to the in-memory apps
 * (no sockets, for tests).
 */
export function fakeFetch(fake: ReturnType<typeof createFakeHermes>) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const app = url.hostname === 'fake-api' ? fake.api : url.hostname === 'fake-dash' ? fake.dash : null;
    if (!app) throw new TypeError(`fetch failed: unknown host ${url.hostname}`);
    return app.fetch(new Request(url, init));
  };
}
