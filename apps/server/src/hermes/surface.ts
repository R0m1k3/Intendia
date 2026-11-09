import { z } from 'zod';
import { HermesError, type HermesHttp, type Method } from './http.js';

/**
 * What an instance says about itself: version, API server capabilities (feature flags and the
 * endpoint map), and the dashboard's OpenAPI path list. Connectors resolve their routes against
 * this instead of trusting hard-coded paths.
 */
export interface Surface {
  fetchedAt: number;
  version: string | null;
  api: {
    reachable: boolean;
    error?: string;
    features: Record<string, unknown>;
    /** capability name -> route, from /v1/capabilities `endpoints` */
    endpoints: Record<string, { method: string; path: string }> | null;
  };
  dash: {
    configured: boolean;
    reachable: boolean;
    error?: string;
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
    api: { reachable: false, features: {}, endpoints: null },
    dash: { configured: http.hasDashboard(), reachable: false, routes: null },
  };

  const apiTask = (async () => {
    try {
      const caps = CapabilitiesSchema.parse(await http.json('api', 'GET', '/v1/capabilities'));
      surface.api.reachable = true;
      surface.api.features = caps.features ?? {};
      surface.api.endpoints = caps.endpoints ?? null;
    } catch (err) {
      surface.api.error = describe(err);
    }
    try {
      const health = HealthSchema.parse(await http.json('api', 'GET', '/health/detailed'));
      surface.api.reachable = true;
      surface.version ??= health.version ?? null;
    } catch (err) {
      surface.api.error ??= describe(err);
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
      return;
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
