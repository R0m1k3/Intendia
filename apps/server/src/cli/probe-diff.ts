/**
 * Compares two `probe record` recordings. Rule: only what can break Intendia is a change — a removed
 * route / endpoint / feature / response field, a changed HTTP status, a changed field type. Additions
 * are notes. Module states are not compared with the old recording's frozen compat report: they are
 * judged by `probe record --strict` (current code) and by compat.test.ts on every recording.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RecordingDiff {
  header: string;
  changes: string[];
  notes: string[];
}

type Surface = {
  version?: string;
  api: { features?: Record<string, unknown>; endpoints?: Record<string, { method: string; path: string }> | null };
  dash: { routes?: string[] | null };
};

function typeOf(x: unknown): string {
  if (Array.isArray(x)) return 'array';
  return x === null ? 'null' : typeof x;
}

/** An empty array tells nothing about its elements: recorded as unknown so its type cannot differ. */
function fieldType(v: unknown): string {
  return Array.isArray(v) && v.length === 0 ? 'array?' : typeOf(v);
}

/**
 * Flattens a body into `path → type`, down to depth 2; arrays are described by their first element,
 * whose type is recorded at `path[]` (so `["a"]` → `[1]` is a change, primitives included).
 */
export function fields(x: unknown, prefix = '', depth = 0, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(x)) {
    if (x.length) {
      out.set(`${prefix}[]`, fieldType(x[0]));
      fields(x[0], `${prefix}[]`, depth, out);
    }
    return out;
  }
  if (!x || typeof x !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.set(path, fieldType(v));
    fields(v, path, depth + 1, out);
  }
  return out;
}

/** Same type, or `null` on one side (a value, not a schema change), or an empty array against an array. */
function sameType(a: string, b: string): boolean {
  if (a === b || a === 'null' || b === 'null') return true;
  const arr = (t: string) => t === 'array' || t === 'array?';
  return arr(a) && arr(b);
}

/** True when `path` lies inside an array that is empty in the other body (nothing known about its elements). */
function underEmptyArray(path: string, body: unknown, other: Map<string, string>): boolean {
  for (let i = path.indexOf('[]'); i >= 0; i = path.indexOf('[]', i + 2)) {
    const p = path.slice(0, i);
    if (p === '' ? Array.isArray(body) && body.length === 0 : other.get(p) === 'array?') return true;
  }
  return false;
}

export function diffRecordings(a: string, b: string): RecordingDiff {
  const load = (d: string, f: string) => JSON.parse(readFileSync(join(d, f), 'utf8'));
  const sa = load(a, 'surface.json') as Surface;
  const sb = load(b, 'surface.json') as Surface;
  const changes: string[] = [];
  const notes: string[] = [];

  const setDiff = (label: string, x: string[], y: string[]) => {
    for (const v of x) if (!y.includes(v)) changes.push(`${label}: - ${v}`);
    for (const v of y) if (!x.includes(v)) notes.push(`${label}: + ${v}`);
  };
  const ep = (s: Surface) => Object.entries(s.api.endpoints ?? {}).map(([k, v]) => `${k}: ${v.method} ${v.path}`);
  setDiff('API server endpoint', ep(sa), ep(sb));
  const feats = (s: Surface) => Object.entries(s.api.features ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  setDiff('API server feature', feats(sa), feats(sb));
  setDiff('Dashboard route', sa.dash.routes ?? [], sb.dash.routes ?? []);

  for (const via of ['api', 'dash']) {
    const da = join(a, via);
    const db = join(b, via);
    const fa = existsSync(da) ? readdirSync(da).filter((f) => f !== 'openapi.json') : [];
    const fb = existsSync(db) ? readdirSync(db).filter((f) => f !== 'openapi.json') : [];
    for (const f of fb) if (!fa.includes(f)) notes.push(`${via}/${f}: newly recorded`);
    for (const f of fa) {
      if (!fb.includes(f)) { changes.push(`${via}/${f}: no longer recorded`); continue; }
      const ra = load(da, f);
      const rb = load(db, f);
      if (ra.status !== rb.status) { changes.push(`${via}/${f}: HTTP ${ra.status} → ${rb.status}`); continue; }
      const ka = fields(ra.body);
      const kb = fields(rb.body);
      for (const [path, t] of ka) {
        const u = kb.get(path);
        if (u === undefined) { if (!underEmptyArray(path, rb.body, kb)) changes.push(`${via}/${f}: - ${path}`); }
        else if (!sameType(t, u)) changes.push(`${via}/${f}: ${path}: ${t} → ${u}`);
      }
      for (const path of kb.keys()) if (!ka.has(path) && !underEmptyArray(path, ra.body, ka)) notes.push(`${via}/${f}: + ${path}`);
    }
  }

  if (existsSync(join(b, 'compat-report.json'))) {
    const cb = load(b, 'compat-report.json') as { modules?: { id: string; state: string }[] };
    for (const m of cb.modules ?? []) notes.push(`module ${m.id}: ${m.state}`);
  }
  return { header: `Hermes ${sa.version} → ${sb.version}`, changes, notes };
}
