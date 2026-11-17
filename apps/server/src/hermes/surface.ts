import { z } from 'zod';
import { HermesError, isTransient, type HermesHttp, type Method } from './http.js';
import { msg } from '../i18n/index.js';

/**
 * What an instance says about itself: version, API server capabilities (feature flags and the
 * endpoint map), and the dashboard's OpenAPI path list. Connectors resolve their routes against
 * this instead of trusting hard-coded paths.
 */
export type Auth = 'ok' | 'refused' | 'unknown';

const refusal = (err: unknown): number | null =>
  err instanceof HermesError && err.kind === 'http' && (err.detail.status === 401 || err.detail.status === 403) ? err.detail.status : null;

export interface Surface {
  fetchedAt: number;
  version: string | null;
  api: {
    reachable: boolean;
    error?: string;
    /** `refused`: /v1/capabilities answered 401/403 (wrong key); `unknown`: not read. */
    auth: Auth;
    /** Both /v1/capabilities and /health/detailed failed, the last one with a passing error (outage). */
    down: boolean;
    features: Record<string, unknown>;
    /** capability name -> route, from /v1/capabilities `endpoints` */
    endpoints: Record<string, { method: string; path: string }> | null;
  };
  dash: {
    configured: boolean;
    reachable: boolean;
    error?: string;
    /** Token check by `GET /api/profiles` (`/api/status` is public): `refused` on 401/403, `unknown` on another error. */
    auth: Auth;
    /** /api/status failed with a passing error (outage). */
    down: boolean;
    version?: string;
    /** "METHOD /path/{param}" entries from /openapi.json, null if the spec is unavailable */
    routes: string[] | null;
  };
}

const CapabilitiesSchema = z.looseObject({
  features: z.record(z.string(), z.unknown()).optional(),
  endpoints: z.record(z.string(), z.looseObject({ method: z.string(), path: z.string() })).optional(),
});
const HealthSchema = z.looseObject({ version: z.string().optional() });
const StatusSchema = z.looseObject({ version: z.string().optional() });
const OpenApiSchema = z.looseObject({ paths: z.record(z.string(), z.record(z.string(), z.unknown())) });

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function describe(err: unknown): string {
  if (err instanceof HermesError) return err.message;
  if (err instanceof z.ZodError) return `unexpected response shape (${err.issues[0]?.path.join('.') ?? '?'})`;
  return (err as Error).message ?? String(err);
}

export async function discover(http: HermesHttp): Promise<Surface> {
  const surface: Surface = {
    fetchedAt: Date.now(),
    version: null,
    api: { reachable: false, auth: 'unknown', down: false, features: {}, endpoints: null },
    dash: { configured: http.hasDashboard(), reachable: false, auth: 'unknown', down: false, routes: null },
  };

  const apiTask = (async () => {
    try {
      const caps = CapabilitiesSchema.parse(await http.json('api', 'GET', '/v1/capabilities'));
      surface.api.reachable = true;
      surface.api.features = caps.features ?? {};
      surface.api.endpoints = caps.endpoints ?? null;
      surface.api.auth = 'ok';
    } catch (err) {
      const status = refusal(err);
      if (status) {
        // Hermes answered: the key is wrong, the server is there (/health/detailed would refuse it too)
        surface.api.reachable = true;
        surface.api.auth = 'refused';
        surface.api.error = msg('clé de l’API server refusée par Hermes (HTTP {status})', { status });
        return;
      }
      surface.api.error = describe(err);
    }
    try {
      const health = HealthSchema.parse(await http.json('api', 'GET', '/health/detailed'));
      surface.api.reachable = true;
      surface.version ??= health.version ?? null;
    } catch (err) {
      surface.api.error ??= describe(err);
      if (!surface.api.reachable && isTransient(err)) surface.api.down = true;
    }
  })();

  const dashTask = (async () => {
    if (!surface.dash.configured) return;
    try {
      const status = StatusSchema.parse(await http.json('dash', 'GET', '/api/status'));
      surface.dash.reachable = true;
      surface.dash.version = status.version;
    } catch (err) {
      surface.dash.error = describe(err);
      surface.dash.down = isTransient(err);
      return;
    }
    // /api/status is public: a cheap authenticated read tells whether the token is still accepted
    try {
      await http.json('dash', 'GET', '/api/profiles', { timeoutMs: 10_000 });
      surface.dash.auth = 'ok';
    } catch (err) {
      const status = refusal(err);
      if (status) {
        surface.dash.auth = 'refused';
        surface.dash.error = msg('jeton du dashboard refusé par Hermes (HTTP {status})', { status });
      }
    }
    try {
      const spec = OpenApiSchema.parse(await http.json('dash', 'GET', '/openapi.json', { timeoutMs: 30_000 }));
      const routes: string[] = [];
      for (const [path, ops] of Object.entries(spec.paths)) {
        for (const m of Object.keys(ops)) if (HTTP_METHODS.has(m)) routes.push(`${m.toUpperCase()} ${path}`);
      }
      surface.dash.routes = routes.sort();
    } catch {
      // No spec: routes are then only checked by their read probes.
      surface.dash.routes = null;
    }
  })();

  await Promise.all([apiTask, dashTask]);
  surface.version ??= surface.dash.version ?? null;
  return surface;
}

/** Normalises "{run_id}" / "{id}" / ":id" into "{}" so templates compare across renames of the parameter. */
export function routeKey(method: Method | string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/\{[^}]+\}|:[A-Za-z_]+/g, '{}')}`;
}
