/**
 * probe — records what a Hermes instance answers, read-only, to write and check connector schemas.
 *
 *   pnpm probe record  [--out DIR] [--strict]   (--strict: exit 3 if a module is degraded; env: PROBE_API, PROBE_API_KEY, PROBE_DASH, PROBE_DASH_TOKEN)
 *   pnpm probe diff DIR_A DIR_B        compare two recordings: removals and status / type changes are changes,
 *                                      additions and module states are notes (probe-diff.ts)
 *                                      exit 0 = no change, 4 = at least one change, 1 = error
 *
 * Secrets are redacted: values of keys that look like credentials, the keys used for the probe,
 * and PROBE_REDACT (comma-separated strings, e.g. a home directory).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstanceConfigSchema } from '../config.js';
import { checkInstance } from '../compat/engine.js';
import { MODULES } from '../connectors/index.js';
import { HermesHttp, type Via } from '../hermes/http.js';
import { discover } from '../hermes/surface.js';
import { fixtureName, redact } from './fixtures.js';
import { diffRecordings } from './probe-diff.js';

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}

async function record(outArg: string | undefined, strict: boolean) {
  const env = process.env;
  const inst = InstanceConfigSchema.parse({
    id: 'probe',
    label: 'probe',
    api: env.PROBE_API ?? 'http://127.0.0.1:8642',
    apiKey: env.PROBE_API_KEY,
    dashboard: env.PROBE_DASH || undefined,
    dashboardToken: env.PROBE_DASH_TOKEN || undefined,
  });
  const extra = [inst.apiKey, inst.dashboardToken ?? '', ...(env.PROBE_REDACT ?? '').split(',')].filter(Boolean);
  const http = new HermesHttp(inst);
  const surface = await discover(http);
  if (!surface.api.reachable) throw new Error(`API server unreachable: ${surface.api.error}`);
  const version = surface.version ?? 'unknown';
  const out = resolve(outArg ?? join(repoRoot(), 'fixtures', `hermes-${version}`));
  mkdirSync(join(out, 'api'), { recursive: true });
  mkdirSync(join(out, 'dash'), { recursive: true });

  const save = (file: string, data: unknown) => writeFileSync(join(out, file), JSON.stringify(redact(data, extra), null, 2) + '\n');

  // Every read route any connector may use (all candidates, so the fake server can serve fallbacks).
  const targets = new Map<string, { via: Via; path: string }>();
  const add = (via: Via, path: string) => targets.set(`${via} ${path}`, { via, path });
  add('api', '/v1/capabilities');
  add('api', '/health/detailed');
  add('api', '/health');
  if (surface.dash.configured) {
    add('dash', '/api/status');
  }
  for (const mod of MODULES) {
    for (const op of Object.values(mod.ops)) {
      if (op.kind !== 'read') continue;
      for (const r of op.routes) {
        const path = r.via === 'api' && r.capability && surface.api.endpoints?.[r.capability]?.path || r.path;
        if (!path.includes('{') && (r.via === 'api' || surface.dash.configured)) add(r.via, path);
      }
    }
  }

  let n = 0;
  for (const { via, path } of targets.values()) {
    try {
      const res = await http.request(via, 'GET', path);
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep text */ }
      save(join(via, fixtureName('GET', path)), { status: res.status, body });
      console.log(`${String(res.status).padEnd(4)} ${via.padEnd(4)} ${path}`);
      n++;
    } catch (err) {
      console.log(`ERR  ${via.padEnd(4)} ${path}: ${(err as Error).message}`);
    }
  }
  if (surface.dash.configured && surface.dash.reachable) {
    try {
      save('dash/openapi.json', await http.json('dash', 'GET', '/openapi.json', { timeoutMs: 30_000 }));
    } catch (err) {
      console.log(`ERR  dash /openapi.json: ${(err as Error).message}`);
    }
  }
  save('surface.json', {
    version,
    recordedAt: new Date().toISOString(),
    api: { features: surface.api.features, endpoints: surface.api.endpoints },
    dash: { configured: surface.dash.configured, reachable: surface.dash.reachable, routes: surface.dash.routes },
  });
  const { report } = await checkInstance(http);
  save('compat-report.json', { ...report, checkedAt: 0 });
  console.log(`\n${n} responses recorded in ${out}`);
  for (const m of report.modules) console.log(`  ${m.state.padEnd(12)} ${m.label}${m.reasons.length ? ` — ${m.reasons.join(' ; ')}` : ''}`);
  const degraded = report.modules.filter((m) => m.state !== 'full');
  if (strict && degraded.length > 0) {
    console.error(`\n${degraded.length} module(s) degraded on Hermes ${version}`);
    process.exitCode = 3;
  }
}

function diff(a: string, b: string) {
  const { header, changes, notes } = diffRecordings(a, b);
  console.log(`${header}\n`);
  console.log(changes.length ? changes.join('\n') : 'No change.');
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  ${n}`).join('\n')}`);
  process.exit(changes.length ? 4 : 0);
}

const [cmd = 'record', ...rest] = process.argv.slice(2);
try {
  if (cmd === 'record') {
    const i = rest.indexOf('--out');
    await record(i >= 0 ? rest[i + 1] : undefined, rest.includes('--strict'));
  } else if (cmd === 'diff' && rest.length === 2) {
    diff(resolve(rest[0]!), resolve(rest[1]!));
  } else {
    console.log('usage: probe record [--out DIR] [--strict] | probe diff DIR_A DIR_B');
    process.exit(2);
  }
} catch (err) {
  console.error(`probe: ${(err as Error).message}`);
  process.exit(1);
}
