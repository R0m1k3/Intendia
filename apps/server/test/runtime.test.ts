import { describe, expect, it, vi } from 'vitest';
import { checkInstance } from '../src/compat/engine.js';
import { callOp, ModuleUnavailableError } from '../src/connectors/runtime.js';
import { createFakeHermes, fakeFetch } from 'fake-hermes';
import { HermesError, HermesHttp } from '../src/hermes/http.js';
import { FIXTURES, fakeInstance } from './helpers.js';

describe('callOp', () => {
  it('a function body receives the via of the chosen route', async () => {
    for (const [inst, expected] of [[fakeInstance(), 'dash'], [fakeInstance({ dashboard: undefined, dashboardToken: undefined }), 'api']] as const) {
      const fake = createFakeHermes({ fixturesDir: FIXTURES });
      const http = new HermesHttp(inst, fakeFetch(fake));
      const { report } = await checkInstance(http);
      const seen: string[] = [];
      await callOp(http, report, 'crons', 'create', {
        body: (via: 'api' | 'dash') => { seen.push(via); return { name: 'n', prompt: 'p', schedule: 'every 30m' }; },
      });
      expect(seen).toEqual([expected]);
      const sent = fake.requests.findLast((r) => r.method === 'POST');
      expect(sent?.body).toMatchObject({ schedule: 'every 30m' });
    }
  });
});

describe('HermesHttp signals and aborts', () => {
  it('a schema mismatch in callOp is told to the observer, then thrown', async () => {
    const breaks: Record<string, { status?: number; body?: unknown }> = {};
    const fake = createFakeHermes({ fixturesDir: FIXTURES, breaks });
    const { report } = await checkInstance(new HermesHttp(fakeInstance(), fakeFetch(fake)));
    fake.requests.length = 0;
    const seen: HermesError[] = [];
    const http = new HermesHttp(fakeInstance(), fakeFetch(fake), { onError: (e) => seen.push(e) });
    const job = '2f08171630f2';
    breaks[`dash GET /api/cron/jobs/${job}`] = { body: { pas: 'un job' } };
    const err = await callOp<never>(http, report, 'crons', 'get', { params: { job_id: job } }).catch((e: unknown) => e as HermesError);
    expect(err.kind).toBe('schema');
    expect(seen.map((e) => e.kind)).toEqual(['schema']);
  });

  it('an already aborted signal fails at once (network, aborted) without fetch, and is not told', async () => {
    const fetchImpl = vi.fn();
    const seen: HermesError[] = [];
    const http = new HermesHttp(fakeInstance(), fetchImpl, { onError: (e) => seen.push(e) });
    const ctrl = new AbortController();
    ctrl.abort();
    const err = (await http.json('api', 'GET', '/health', { signal: ctrl.signal }).catch((e: unknown) => e)) as HermesError;
    expect(err.kind).toBe('network');
    expect(err.detail.aborted).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('the abort listener is removed after json() and kept for request()', async () => {
    const fake = createFakeHermes({ fixturesDir: FIXTURES });
    const http = new HermesHttp(fakeInstance(), fakeFetch(fake));
    const ctrl = new AbortController();
    const remove = vi.spyOn(ctrl.signal, 'removeEventListener');
    await http.json('api', 'GET', '/health', { signal: ctrl.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    remove.mockClear();
    await http.request('api', 'GET', '/health', { signal: ctrl.signal });
    expect(remove).not.toHaveBeenCalled();
  });

  it('a 401 of request() is told, an anonymous one is not; ModuleUnavailableError takes the op code', async () => {
    const fake = createFakeHermes({ fixturesDir: FIXTURES });
    const seen: HermesError[] = [];
    const http = new HermesHttp(fakeInstance({ dashboardToken: 'mauvais-jeton-0000' }), fakeFetch(fake), { onError: (e) => seen.push(e) });
    expect((await http.request('dash', 'GET', '/api/profiles')).status).toBe(401);
    expect((await http.request('dash', 'GET', '/api/profiles', { anonymous: true })).status).toBe(401);
    await http.json('dash', 'GET', '/api/profiles', { anonymous: true }).catch(() => undefined);
    expect(seen.map((e) => e.detail.status)).toEqual([401]);

    const { report } = await checkInstance(new HermesHttp(fakeInstance({ dashboardToken: 'mauvais-jeton-0000' }), fakeFetch(fake)));
    const err = await callOp<never>(http, report, 'kanban', 'board').catch((e: unknown) => e as ModuleUnavailableError);
    expect(err).toBeInstanceOf(ModuleUnavailableError);
    expect(err.code).toBe('dash_token_refused');
  });
});

