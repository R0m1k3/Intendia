import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createFakeHermes, fakeFetch, FAKE_API_KEY, FAKE_DASH_TOKEN, type FakeOptions } from 'fake-hermes';
import { InstanceConfigSchema, type InstanceConfig } from '../src/config.js';
import { HermesHttp } from '../src/hermes/http.js';

export const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/hermes-0.23.0');

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

export function fakeHttp(opts: Omit<FakeOptions, 'fixturesDir'> = {}, inst = fakeInstance()) {
  const fetchImpl = fakeFetch(createFakeHermes({ fixturesDir: FIXTURES, ...opts }));
  return { http: new HermesHttp(inst, fetchImpl), fetchImpl };
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'intendia-test-'));
}

/**
 * Full app against fake-hermes, logged in, with a temporary workspace mount.
 * `request` adds the session cookie and the X-Intendia header.
 */
export async function testApp(opts: Omit<FakeOptions, 'fixturesDir'> & { mount?: string; instance?: Partial<InstanceConfig>; env?: Record<string, string> } = {}) {
  const { createApp } = await import('../src/app.js');
  const { Auth } = await import('../src/auth/auth.js');
  const { CompatService } = await import('../src/compat/service.js');
  const { loadConfig } = await import('../src/config.js');
  const { openDb } = await import('../src/db/index.js');
  const { InstanceStore } = await import('../src/instances/store.js');
  const { createServices } = await import('../src/services.js');
  const { createMcpApp } = await import('../src/mcp/server.js');

  const dataDir = tempDir();
  const mount = opts.mount ?? tempDir();
  const inst = fakeInstance({ mount, profileKeys: opts.profileKeys ?? {}, ...opts.instance });
  const config = loadConfig({
    INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_TRUST_PROXY: 'true',
    INTENDIA_INSTANCES: JSON.stringify([inst]), ...opts.env,
  });
  const db = openDb(dataDir);
  const store = new InstanceStore(db, config);
  const auth = new Auth(db, config);
  const fake = createFakeHermes({ fixturesDir: FIXTURES, ...opts });
  const fetchImpl = fakeFetch(fake);
  const compat = new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl);
  await compat.check(inst.id);
  const services = createServices({ config, db, store });
  const app = createApp({ config, db, auth, store, compat, fetchImpl, services, version: 'test' });
  const mcp = createMcpApp({ db, store, links: services.links, config, version: 'test' });

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
  return { app, mcp, db, mount, fake, inst, store, compat, config, services, links: services.links, request, raw, rawRequest };
}

/** Reads an SSE body into events ({id, data}); stops at the end of the stream or after `ms`. */
export async function readSse(res: Response, ms = 2000): Promise<{ id: string | null; data: any }[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
    ]);
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return buf.split('\n\n').filter((f) => f.includes('data:')).map((f) => {
    const id = /^id: (.*)$/m.exec(f)?.[1] ?? null;
    const data = JSON.parse(/^data: (.*)$/m.exec(f)![1]!);
    return { id, data };
  });
}

/** Polls the Intendia run status until it is terminal. */
export async function waitRun(t: Awaited<ReturnType<typeof testApp>>, base: string, runId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const s = (await t.request('GET', `${base}/runs/${runId}`)).json.status as string;
    if (['completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(s)) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('run did not finish');
}
