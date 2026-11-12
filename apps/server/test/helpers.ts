import { readSseFrames } from '../src/connectors/sse.js';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFakeHermes, fakeFetch, fakeWebSocketFactory, FAKE_API_KEY, FAKE_DASH_TOKEN, REFERENCE_FIXTURES, type FakeOptions } from 'fake-hermes';
import { InstanceConfigSchema, type InstanceConfig } from '../src/config.js';
import { HermesHttp } from '../src/hermes/http.js';

/** Recording the behaviour tests replay (it holds a session, a cron and a provider key). */
export const FIXTURES = resolve(import.meta.dirname, '../../../fixtures', REFERENCE_FIXTURES);
/** Every recorded Hermes release (`fixtures/hermes-<version>`), checked by the compatibility tests. */
export const RECORDINGS = readdirSync(resolve(import.meta.dirname, '../../../fixtures'))
  .filter((d) => d.startsWith('hermes-')).sort()
  .map((d) => ({ version: d.slice('hermes-'.length), dir: resolve(import.meta.dirname, '../../../fixtures', d) }));

export function fakeInstance(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return InstanceConfigSchema.parse({
    id: 'fake',
    label: 'Fake',
    api: 'http://fake-api',
    apiKey: FAKE_API_KEY,
    dashboard: 'http://fake-dash',
    dashboardToken: FAKE_DASH_TOKEN,
    dashboardLink: 'https://dash.example.test',
    ...overrides,
  });
}

export function fakeHttp(opts: Partial<FakeOptions> = {}, inst = fakeInstance()) {
  const fake = createFakeHermes({ fixturesDir: FIXTURES, ...opts });
  const fetchImpl = fakeFetch(fake);
  return { http: new HermesHttp(inst, fetchImpl), fetchImpl, fake };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'intendia-test-'));
}

/** Routes each instance's hosts to its own fake (`<id>-api` / `<id>-dash`), the main one on fake-api / fake-dash. */
export function combineFetch(routes: { hosts: { api: string; dash: string }; fetch: ReturnType<typeof fakeFetch> }[]) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const host = new URL(input).hostname;
    const r = routes.find((x) => x.hosts.api === host || x.hosts.dash === host);
    if (!r) throw new TypeError(`fetch failed: unknown host ${host}`);
    return r.fetch(input, init);
  };
}

/**
 * Full app against fake-hermes, logged in. The fake's managed files root (a temporary folder, `root`) is the
 * workspace root of the instance. `request` adds the session cookie and the X-Intendia header.
 * `extra`: more instances (own id and label), served by the same fake, or by their own fake (own files root,
 * hosts `<id>-api` / `<id>-dash`) with `ownFake: true`.
 */
export async function testApp(opts: Omit<FakeOptions, 'fixturesDir'> & {
  instance?: Partial<InstanceConfig>; extra?: (Partial<InstanceConfig> & { ownFake?: boolean })[]; env?: Record<string, string>;
  uploadTimeoutMs?: number; fileOpts?: import('../src/files/service.js').FileServiceOpts;
} = {}) {
  const { createApp } = await import('../src/app.js');
  const { Auth } = await import('../src/auth/auth.js');
  const { CompatService } = await import('../src/compat/service.js');
  const { loadConfig } = await import('../src/config.js');
  const { openDb } = await import('../src/db/index.js');
  const { InstanceStore } = await import('../src/instances/store.js');
  const { createServices } = await import('../src/services.js');
  const { createMcpApp } = await import('../src/mcp/server.js');

  const dataDir = tempDir();
  const inst = fakeInstance({ profileKeys: opts.profileKeys ?? {}, ...opts.instance });
  const fake = createFakeHermes({ fixturesDir: FIXTURES, filesRoot: tempDir(), ...opts });
  const routes = [{ hosts: { api: 'fake-api', dash: 'fake-dash' }, fetch: fakeFetch(fake) }];
  const fakes: Record<string, ReturnType<typeof createFakeHermes>> = { [inst.id]: fake };
  const extra = (opts.extra ?? []).map(({ ownFake, ...e }) => {
    if (!ownFake) {
      const x = fakeInstance({ profileKeys: opts.profileKeys ?? {}, ...e });
      fakes[x.id] = fake;
      return x;
    }
    const id = e.id ?? 'x';
    const hosts = { api: `${id}-api`, dash: `${id}-dash` };
    const own = createFakeHermes({ fixturesDir: FIXTURES, filesRoot: tempDir() });
    routes.push({ hosts, fetch: fakeFetch(own, hosts) });
    fakes[id] = own;
    return fakeInstance({ profileKeys: opts.profileKeys ?? {}, api: `http://${hosts.api}`, dashboard: `http://${hosts.dash}`, ...e });
  });
  const config = loadConfig({
    INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_TRUST_PROXY: 'true',
    INTENDIA_INSTANCES: JSON.stringify([inst, ...extra]), ...opts.env,
  });
  const db = openDb(dataDir);
  const store = new InstanceStore(db, config);
  const auth = new Auth(db, config);
  const fetchImpl = combineFetch(routes);
  const compat = new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl, fakeWebSocketFactory(fake));
  await compat.check(inst.id);
  for (const e of extra) await compat.check(e.id);
  const services = createServices({ config, db, store, compat, uploadTimeoutMs: opts.uploadTimeoutMs, fileOpts: opts.fileOpts });
  const app = createApp({ config, db, auth, store, compat, fetchImpl, services, version: 'test', wsFactory: fakeWebSocketFactory(fake), wsOpenTimeoutMs: 300 });
  const mcp = createMcpApp({ db, store, links: services.links, roots: services.roots, config, version: 'test' });

  let cookie = '';
  const raw = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Intendia': '1', 'X-Forwarded-For': '10.0.0.9', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return res;
  };
  const request = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await raw(method, path, body, headers);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  /** Any body (bytes, text), with or without the session cookie and the X-Intendia header. */
  const rawRequest = (method: string, path: string, o: { body?: Buffer | string; headers?: Record<string, string>; cookie?: boolean; csrf?: boolean } = {}) =>
    app.request(path, {
      method,
      headers: {
        'X-Forwarded-For': '10.0.0.9',
        ...(o.csrf === false ? {} : { 'X-Intendia': '1' }),
        ...(o.cookie === false || !cookie ? {} : { Cookie: cookie }),
        ...o.headers,
      },
      body: typeof o.body === "string" || o.body === undefined ? o.body : new Uint8Array(o.body),
    });
  await raw('POST', '/x/setup/password', { code: auth.setupCode, password: 'test-password-123' });
  /** Workspace root of the main instance (the fake's managed files root, real path). */
  const root = fake.files.root;
  return { app, mcp, db, root, fake, fakes, inst, store, compat, config, services, links: services.links, request, raw, rawRequest };
}

/** Reads an SSE body into events ({id, data}); stops at the end of the stream or after `ms`. */
export const readSse = (res: Response, ms = 2000) => readSseFrames(res, { maxMs: ms });

/** Polls the Intendia run status until it is terminal. */
export async function waitRun(t: Awaited<ReturnType<typeof testApp>>, base: string, runId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const s = (await t.request('GET', `${base}/runs/${runId}`)).json.status as string;
    if (['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(s)) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('run did not finish');
}
