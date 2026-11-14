import { z } from 'zod';
import { MODULES } from '../connectors/index.js';
import type { CompatReport, ModuleDef, ModuleReport, ModuleState, OpDef, ResolvedOp, RouteDef } from '../connectors/types.js';
import { HermesError, type HermesHttp, type Method } from '../hermes/http.js';
import { discover, routeKey, type Surface } from '../hermes/surface.js';
import { msg } from '../i18n/index.js';

function errText(route: string, err: unknown): string {
  if (err instanceof z.ZodError) {
    const i = err.issues[0];
    return i
      ? msg('{route} : réponse inattendue ({where} : {detail})', { route, where: i.path.join('.') || msg('racine'), detail: i.message })
      : msg('{route} : réponse inattendue (schéma)', { route });
  }
  const detail = err instanceof HermesError && err.detail.status ? `HTTP ${err.detail.status}` : ((err as Error).message ?? String(err));
  return msg('{what} : {detail}', { what: route, detail });
}

/** Picks the concrete route a RouteDef maps to on this instance, or explains why it cannot. */
function locate(route: RouteDef, surface: Surface): { ok: true; method: Method; path: string } | { ok: false; note: string } {
  const label = `${route.via === 'api' ? 'API server' : 'dashboard'} ${route.method} ${route.path}`;
  if (route.via === 'api') {
    if (!surface.api.reachable) return { ok: false, note: msg('{label} : API server injoignable', { label }) };
    if (route.feature && surface.api.features[route.feature] === false) {
      return { ok: false, note: msg('{label} : fonction « {feature} » désactivée dans /v1/capabilities', { label, feature: route.feature }) };
    }
    if (route.capability && surface.api.endpoints) {
      const announced = surface.api.endpoints[route.capability];
      if (!announced) return { ok: false, note: msg('{label} : absente de /v1/capabilities', { label }) };
      return { ok: true, method: announced.method.toUpperCase() as Method, path: announced.path };
    }
    return { ok: true, method: route.method, path: route.path };
  }
  if (!surface.dash.configured) return { ok: false, note: msg('{label} : dashboard non configuré pour cette instance', { label }) };
  if (!surface.dash.reachable) return { ok: false, note: msg('{label} : dashboard injoignable', { label }) };
  if (surface.dash.routes && !surface.dash.routes.some((r) => routeKey(r.split(' ')[0]!, r.slice(r.indexOf(' ') + 1)) === routeKey(route.method, route.path))) {
    return { ok: false, note: msg("{label} : absente de l'OpenAPI du dashboard", { label }) };
  }
  return { ok: true, method: route.method, path: route.path };
}

function shouldProbe(op: OpDef, path: string): boolean {
  return op.kind === 'read' && op.probe !== false && !path.includes('{');
}

export async function resolveOp(http: HermesHttp, surface: Surface, op: OpDef): Promise<ResolvedOp> {
  const notes: string[] = [];
  for (const route of op.routes) {
    const loc = locate(route, surface);
    if (!loc.ok) {
      notes.push(loc.note);
      continue;
    }
    if (shouldProbe(op, loc.path)) {
      try {
        const body = await http.json(route.via, loc.method, loc.path, { query: op.probeQuery });
        if (op.schema) op.schema.parse(body);
      } catch (err) {
        notes.push(errText(`${route.via === 'api' ? 'API server' : 'dashboard'} ${loc.method} ${loc.path}`, err));
        continue;
      }
    }
    return { ok: true, route: { via: route.via, method: loc.method, path: loc.path }, notes };
  }
  return { ok: false, notes };
}

export async function checkModule(http: HermesHttp, surface: Surface, mod: ModuleDef, dashboardLink?: string): Promise<ModuleReport> {
  const ops: Record<string, ResolvedOp> = {};
  for (const [name, op] of Object.entries(mod.ops)) ops[name] = await resolveOp(http, surface, op);

  let state: ModuleState = 'full';
  const reasons: string[] = [];
  for (const [name, op] of Object.entries(mod.ops)) {
    const r = ops[name]!;
    if (r.ok) continue;
    const why = r.notes.at(-1) ?? msg('aucune route');
    if (op.optional) {
      reasons.push(msg('Option « {name} » indisponible — {why}', { name, why }));
    } else if (op.kind === 'read' && op.required) {
      state = 'unavailable';
      reasons.push(msg('Lecture « {name} » impossible — {why}', { name, why }));
    } else if (op.kind === 'write') {
      if (state === 'full') state = 'readonly';
      reasons.push(msg('Écriture « {name} » indisponible — {why}', { name, why }));
    } else {
      reasons.push(msg('Lecture secondaire « {name} » indisponible — {why}', { name, why }));
    }
  }
  return {
    id: mod.id,
    label: mod.label,
    state,
    reasons,
    ops,
    dashboardLink: dashboardLink && mod.dashboardPage ? dashboardLink.replace(/\/$/, '') + mod.dashboardPage : dashboardLink,
  };
}

export async function checkInstance(
  http: HermesHttp,
  modules: readonly ModuleDef[] = MODULES,
): Promise<{ report: CompatReport; surface: Surface }> {
  const surface = await discover(http);
  const reports = await Promise.all(modules.map((m) => checkModule(http, surface, m, http.instance.dashboardLink)));
  return {
    surface,
    report: {
      instanceId: http.instance.id,
      checkedAt: Date.now(),
      hermesVersion: surface.version,
      api: { reachable: surface.api.reachable, error: surface.api.error },
      dash: {
        configured: surface.dash.configured,
        reachable: surface.dash.reachable,
        error: surface.dash.error,
        openapi: surface.dash.routes !== null,
      },
      modules: reports,
    },
  };
}

/** Modules whose state differs between two reports (for notifications). */
export function stateChanges(prev: CompatReport | undefined, next: CompatReport) {
  const before = new Map(prev?.modules.map((m) => [m.id, m.state]));
  return next.modules
    .filter((m) => before.get(m.id) !== m.state && !(prev === undefined && m.state === 'full'))
    .map((m) => ({ module: m.id, label: m.label, from: before.get(m.id) ?? null, to: m.state, reasons: m.reasons }));
}
