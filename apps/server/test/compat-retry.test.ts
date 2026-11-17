import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeHermes, fakeFetch, fakeWebSocketFactory, type FakeOptions } from 'fake-hermes';
import { CompatService, DEBOUNCE_MS, FOLLOW_MS } from '../src/compat/service.js';
import { loadConfig, type InstanceConfig } from '../src/config.js';
import { callOp, ModuleUnavailableError } from '../src/connectors/runtime.js';
import type { CompatReport, ModuleId } from '../src/connectors/types.js';
import { openDb } from '../src/db/index.js';
import { compatReports } from '../src/db/schema.js';
import { HermesError, type FetchLike } from '../src/hermes/http.js';
import { InstanceStore } from '../src/instances/store.js';
import { combineFetch, fakeInstance, FIXTURES, tempDir } from './helpers.js';

const JOB = '2f08171630f2'; // job of the reference recording

type Fake = ReturnType<typeof createFakeHermes>;

function setup(o: {
  fake?: Partial<FakeOptions>; instance?: Partial<InstanceConfig>; wrap?: (f: FetchLike) => FetchLike; db?: ReturnType<typeof openDb>; dataDir?: string;
  /** instance saved in the database instead of INTENDIA_INSTANCES */
  dbInstances?: boolean;
} = {}) {
  const dataDir = o.dataDir ?? tempDir();
  const inst = fakeInstance(o.instance);
  const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, ...(o.dbInstances ? {} : { INTENDIA_INSTANCES: JSON.stringify([inst]) }) });
  const db = o.db ?? openDb(dataDir);
  const store = new InstanceStore(db, config);
  if (o.dbInstances) store.save(inst);
  const breaks: Record<string, { status?: number; body?: unknown }> = { ...o.fake?.breaks };
  const fake = createFakeHermes({ fixturesDir: FIXTURES, filesRoot: tempDir(), ...o.fake, breaks });
  const base = fakeFetch(fake);
  const fetchImpl = o.wrap ? o.wrap(base) : base;
  const moduleStates = vi.fn(async () => {});
  const compat = new CompatService(db, store, { moduleStates }, fetchImpl, fakeWebSocketFactory(fake));
  services.push(compat);
  return { compat, fake, breaks, moduleStates, db, store, dataDir, id: inst.id, inst };
}

const services: CompatService[] = [];
afterEach(() => {
  for (const c of services.splice(0)) c.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const count = (fake: Fake, path: string, via?: 'api' | 'dash') => fake.requests.filter((r) => r.method === 'GET' && r.path === path && (!via || r.via === via)).length;
/** One full check = one GET /v1/capabilities. */
const checks = (fake: Fake) => count(fake, '/v1/capabilities');
const mod = (r: CompatReport | undefined, id: ModuleId) => r!.modules.find((m) => m.id === id)!;

/** Waits until no check, queued check or follow-up step runs (real setImmediate: only timers are faked). */
async function quiet(compat: CompatService) {
  const s = compat as unknown as { running: Map<string, unknown>; queued: Map<string, unknown>; follows: Map<string, { busy: boolean }> };
  for (let i = 0; i < 2000; i++) {
    await new Promise((r) => setImmediate(r));
    if (!s.running.size && !s.queued.size && ![...s.follows.values()].some((f) => f.busy)) {
      for (let j = 0; j < 5; j++) await new Promise((r) => setImmediate(r));
      if (!s.running.size && !s.queued.size) return;
    }
  }
  throw new Error('compat never quiet');
}
const follow = (compat: CompatService, id: string) => (compat as unknown as { follows: Map<string, { checks: number; timer?: unknown }> }).follows.get(id);

function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
}
/** Moves the clock by `ms` and waits for what it started. */
async function advance(compat: CompatService, ms = FOLLOW_MS) {
  await vi.advanceTimersByTimeAsync(ms);
  await quiet(compat);
}

describe('compat follow-up of an unhealthy report', () => {
  it('1. dashboard down at boot then back: probe, check, modules full, follow-up ended', async () => {
    fakeTimers();
    const { compat, fake, id } = setup();
    fake.down.add('dash');
    const r = await compat.check(id);
    expect(r.outage).toMatchObject({ dash: true, api: false });
    expect(mod(r, 'kanban').state).toBe('unavailable');
    expect(mod(r, 'config').state).toBe('unavailable');
    expect(mod(r, 'kanban').ops.board!.code).toBe('hermes_unreachable');
    // crons through the API server
    expect(mod(r, 'crons').ops.list!.route).toMatchObject({ via: 'api', path: '/api/jobs' });
    fake.down.delete('dash');
    const before = checks(fake);
    await advance(compat);
    expect(count(fake, '/api/health', 'dash')).toBe(1);
    expect(checks(fake)).toBe(before + 1);
    const back = compat.get(id)!;
    expect(back.outage).toBeUndefined();
    expect(mod(back, 'kanban').state).toBe('full');
    expect(mod(back, 'config').state).toBe('full');
    expect(follow(compat, id)).toBeUndefined();
  });

  it('2. long dashboard outage: a probe every 30 s, no check while it fails', async () => {
    fakeTimers();
    const attempts: number[] = [];
    const { compat, fake, id } = setup({
      wrap: (f) => (input, init) => {
        if (input.endsWith('/api/health')) attempts.push(Date.now());
        return f(input, init);
      },
    });
    fake.down.add('dash');
    await compat.check(id);
    const start = Date.now();
    const before = checks(fake);
    for (let n = 1; n <= 5; n++) await advance(compat);
    expect(attempts.map((t) => t - start)).toEqual([30_000, 60_000, 90_000, 120_000, 150_000]);
    expect(checks(fake)).toBe(before);
    fake.down.delete('dash');
    await advance(compat);
    expect(checks(fake)).toBe(before + 1);
    expect(compat.get(id)!.outage).toBeUndefined();
  });

  it('3. API server down after a healthy report: outage, fast 504 code, back within 35 s', async () => {
    fakeTimers();
    const { compat, fake, id, moduleStates } = setup();
    await compat.check(id);
    expect(moduleStates).not.toHaveBeenCalled();
    fake.down.add('api');
    const r = await compat.check(id);
    expect(r.outage).toMatchObject({ api: true, dash: false });
    expect(r.outage!.since).toBe(r.checkedAt);
    expect(mod(r, 'chat').state).toBe('unavailable');
    expect(mod(r, 'chat').reasons.join(' ')).toContain('injoignable');
    expect(mod(r, 'kanban').state).toBe('full');
    expect(mod(r, 'crons').ops.list!.ok).toBe(true);
    expect(moduleStates).toHaveBeenCalledTimes(1);
    const n = fake.requests.length;
    const err = await callOp<never>(compat.http(id), r, 'chat', 'createRun', { body: { input: 'x' } }).catch((e: unknown) => e as ModuleUnavailableError);
    expect(err).toBeInstanceOf(ModuleUnavailableError);
    expect(err.code).toBe('hermes_unreachable');
    expect(fake.requests.length).toBe(n);
    fake.down.delete('api');
    await advance(compat);
    expect(count(fake, '/health', 'api')).toBe(1);
    expect(compat.get(id)!.outage).toBeUndefined();
    expect(mod(compat.get(id), 'chat').state).toBe('full');
    expect(moduleStates).toHaveBeenCalledTimes(2);
  });

  it('4. outage.since kept across checks of the same outage', async () => {
    fakeTimers();
    const { compat, fake, id } = setup();
    fake.down.add('api');
    const first = await compat.check(id);
    await vi.advanceTimersByTimeAsync(1000);
    const second = await compat.check(id);
    expect(second.checkedAt).toBeGreaterThan(first.checkedAt);
    expect(second.outage!.since).toBe(first.outage!.since);
  });

  it('5. a probe answering 502 is still down; the check starts once it answers', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    fake.down.add('dash');
    await compat.check(id);
    const before = checks(fake);
    fake.down.delete('dash');
    breaks['dash GET /api/health'] = { status: 502 };
    await advance(compat);
    await advance(compat);
    expect(count(fake, '/api/health', 'dash')).toBe(2);
    expect(checks(fake)).toBe(before);
    delete breaks['dash GET /api/health'];
    await advance(compat);
    expect(checks(fake)).toBe(before + 1);
    expect(compat.get(id)!.outage).toBeUndefined();
  });

  it('6. probe answering while the check still sees the outage: one check per probe recovery', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    breaks['dash GET /api/status'] = { status: 503 };
    expect((await compat.check(id)).outage?.dash).toBe(true);
    const before = checks(fake);
    for (let n = 0; n < 4; n++) await advance(compat);
    expect(checks(fake)).toBe(before + 1);
    breaks['dash GET /api/health'] = { status: 502 };
    await advance(compat);
    expect(checks(fake)).toBe(before + 1);
    delete breaks['dash GET /api/health'];
    await advance(compat);
    expect(checks(fake)).toBe(before + 2);
  });

  it('7. a 500 is not an outage', async () => {
    fakeTimers();
    const { compat, id } = setup({ fake: { breaks: { 'dash GET /api/status': { status: 500 } } } });
    const r = await compat.check(id);
    expect(r.dash.reachable).toBe(false);
    expect(r.outage).toBeUndefined();
    expect(follow(compat, id)).toBeUndefined();
  });

  it('8. passing probe failure: three checks 30 s apart, then only the tick', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    await compat.check(id);
    breaks['dash GET /api/files'] = { status: 503 };
    const r = await compat.check(id);
    expect(mod(r, 'files').ops.list!.transient).toBe(true);
    expect(r.files!.transient).toBe(true);
    expect(r.outage).toBeUndefined();
    const before = checks(fake);
    for (let n = 1; n <= 3; n++) {
      await advance(compat);
      expect(checks(fake)).toBe(before + n);
    }
    await advance(compat);
    await advance(compat);
    expect(checks(fake)).toBe(before + 3);
    await compat.tick();
    await quiet(compat);
    expect(checks(fake)).toBe(before + 4);
    // still the same causes: the tick's check does not start three more
    await advance(compat);
    await advance(compat);
    expect(checks(fake)).toBe(before + 4);
  });

  it('8b. passing failure fixed before the second retry: healthy report, follow-up ended', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    breaks['dash GET /api/files'] = { status: 503 };
    await compat.check(id);
    await advance(compat);
    delete breaks['dash GET /api/files'];
    const before = checks(fake);
    await advance(compat);
    expect(checks(fake)).toBe(before + 1);
    expect(compat.get(id)!.files!.workspaceRoot).toBeTruthy();
    expect(follow(compat, id)).toBeUndefined();
  });

  it('9. missing files root: no follow-up, the tick rechecks only after 15 min', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    await compat.check(id);
    const listing = await callOp<Record<string, unknown>>(compat.http(id), compat.get(id), 'files', 'list');
    breaks['dash GET /api/files'] = { body: { ...listing, locked_root: null } };
    const r = await compat.check(id);
    expect(r.files!.workspaceRoot).toBeNull();
    expect(r.files!.transient).toBeUndefined();
    expect(follow(compat, id)).toBeUndefined();
    const before = checks(fake);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await compat.tick();
    await quiet(compat);
    expect(checks(fake)).toBe(before);
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await compat.tick();
    await quiet(compat);
    expect(checks(fake)).toBe(before + 1);
  });

  it('10. a new outage after a finished follow-up starts a new one', async () => {
    fakeTimers();
    const { compat, fake, id } = setup();
    fake.down.add('dash');
    await compat.check(id);
    fake.down.delete('dash');
    await advance(compat);
    expect(follow(compat, id)).toBeUndefined();
    fake.down.add('dash');
    await compat.check(id);
    expect(follow(compat, id)).toBeDefined();
    fake.down.delete('dash');
    const probes = count(fake, '/api/health', 'dash');
    await advance(compat);
    expect(count(fake, '/api/health', 'dash')).toBe(probes + 1);
    expect(compat.get(id)!.outage).toBeUndefined();
  });

  it('11. causes that change reset the follow-up: transient, then the dashboard down', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    breaks['dash GET /api/files'] = { status: 503 };
    await compat.check(id);
    await advance(compat);
    await advance(compat);
    expect(follow(compat, id)!.checks).toBe(2);
    fake.down.add('dash');
    await advance(compat);
    expect(compat.get(id)!.outage?.dash).toBe(true);
    expect(follow(compat, id)!.checks).toBe(0);
    const before = checks(fake);
    await advance(compat);
    // probes now, no blind checks
    expect(checks(fake)).toBe(before);
    expect(follow(compat, id)!.timer).toBeDefined();
  });

  it('12. forget() or stop() during a step: nothing re-arms, nothing throws', async () => {
    for (const end of ['forget', 'stop'] as const) {
      fakeTimers();
      let release = () => {};
      let slow = false;
      const { compat, fake, id } = setup({
        wrap: (f) => async (input, init) => {
          if (slow && input.endsWith('/api/health')) await new Promise<void>((r) => { release = r; });
          return f(input, init);
        },
      });
      fake.down.add('dash');
      await compat.check(id);
      fake.down.delete('dash');
      slow = true;
      await vi.advanceTimersByTimeAsync(FOLLOW_MS);
      if (end === 'forget') compat.forget(id);
      else compat.stop();
      release();
      await quiet(compat);
      expect(follow(compat, id)).toBeUndefined();
      const before = checks(fake);
      await advance(compat);
      await advance(compat);
      expect(checks(fake)).toBe(before);
      vi.useRealTimers();
    }
  });

  it('13. dashboard token changed: one 401 rechecks, kanban refused with the action, crons kept, tick probes once', async () => {
    fakeTimers();
    const { compat, fake, id } = setup();
    await compat.check(id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.auth.dashToken = 'autre';
    const before = checks(fake);
    const err = await callOp<never>(compat.http(id), compat.get(id), 'kanban', 'board', { query: { board: 'default' } }).catch((e: unknown) => e as HermesError);
    expect(err).toBeInstanceOf(HermesError);
    expect(err.detail.status).toBe(401);
    await quiet(compat);
    expect(checks(fake)).toBe(before + 1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('recheck (auth)'))).toBe(true);
    const r = compat.get(id)!;
    expect(r.dash.auth).toBe('refused');
    expect(r.dash.reachable).toBe(true);
    expect(mod(r, 'kanban').state).toBe('unavailable');
    expect(mod(r, 'kanban').reasons.join(' ')).toContain('jeton du dashboard refusé, mettez-le à jour dans Réglages › Instances › Modifier');
    expect(mod(r, 'kanban').ops.board!.code).toBe('dash_token_refused');
    // crons kept through the API server (cancel and runs exist only on the dashboard)
    expect(mod(r, 'crons').ops.list!.route).toMatchObject({ via: 'api' });
    expect(mod(r, 'crons').state).toBe('readonly');
    expect(follow(compat, id)).toBeUndefined();
    // a second refusal within 30 s: the op is refused at once now, and even a raw 401 would not recheck
    compat.http(id).notify(new HermesError('http', 'x', { via: 'dash', status: 401 }, true));
    await quiet(compat);
    expect(checks(fake)).toBe(before + 1);
    const profiles = count(fake, '/api/profiles', 'dash');
    await compat.tick();
    await quiet(compat);
    expect(count(fake, '/api/profiles', 'dash')).toBe(profiles + 1);
    expect(checks(fake)).toBe(before + 1);
    fake.auth.dashToken = 'fake-dashboard-token';
    await compat.tick();
    await quiet(compat);
    expect(checks(fake)).toBe(before + 2);
    expect(compat.get(id)!.dash.auth).toBe('ok');
  });

  it('14. refused API key: reachable, refused, no outage, no follow-up', async () => {
    const { compat, id } = setup({ instance: { apiKey: 'x'.repeat(16) } });
    const r = await compat.check(id);
    expect(r.api.reachable).toBe(true);
    expect(r.api.auth).toBe('refused');
    expect(r.api.error).toContain('refusée');
    expect(r.outage).toBeUndefined();
    expect(follow(compat, id)).toBeUndefined();
    expect(mod(r, 'chat').ops.createRun!.code).toBe('api_key_refused');
  });

  it('15. unexpected shape at run time: one recheck, then at most one every 3 min', async () => {
    fakeTimers();
    const { compat, fake, breaks, id } = setup();
    await compat.check(id);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    breaks[`dash GET /api/cron/jobs/${JOB}`] = { body: { pas: 'un job' } };
    const get = () => callOp<never>(compat.http(id), compat.get(id), 'crons', 'get', { params: { job_id: JOB } }).catch((e: unknown) => e as HermesError);
    const before = checks(fake);
    expect((await get()).kind).toBe('schema');
    await quiet(compat);
    expect(checks(fake)).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await get();
    await quiet(compat);
    expect(checks(fake)).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS.shape);
    await get();
    await quiet(compat);
    expect(checks(fake)).toBe(before + 2);
  });

  it('16. a business 404 is no signal, a missing route is', async () => {
    const { compat, fake, breaks, id } = setup();
    await compat.check(id);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = checks(fake);
    await callOp(compat.http(id), compat.get(id), 'sessions', 'get', { params: { session_id: 'inconnu' } }).catch(() => undefined);
    await quiet(compat);
    expect(checks(fake)).toBe(before);
    breaks[`dash GET /api/cron/jobs/${JOB}`] = { status: 404, body: { detail: 'Not Found' } };
    await callOp(compat.http(id), compat.get(id), 'crons', 'get', { params: { job_id: JOB } }).catch(() => undefined);
    await quiet(compat);
    expect(checks(fake)).toBe(before + 1);
  });

  it('17. an aborted caller and an anonymous 401 start nothing', async () => {
    const { compat, fake, id } = setup();
    await compat.check(id);
    const before = checks(fake);
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await callOp<never>(compat.http(id), compat.get(id), 'crons', 'list', { signal: ctrl.signal }).catch((e: unknown) => e as HermesError);
    expect(err.kind).toBe('network');
    expect(err.detail.aborted).toBe(true);
    fake.auth.dashToken = 'autre';
    await compat.http(id).json('dash', 'GET', '/api/profiles', { anonymous: true }).catch(() => undefined);
    await quiet(compat);
    expect(checks(fake)).toBe(before);
    expect(follow(compat, id)).toBeUndefined();
  });

  it('18. requests during a check share one check started after it', async () => {
    const { compat, fake, id } = setup();
    await compat.check(id);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.files.delayMs = 150;
    const before = checks(fake);
    const first = compat.check(id);
    await new Promise((r) => setTimeout(r, 20));
    compat.http(id).notify(new HermesError('http', 'x', { via: 'dash', status: 401 }, true));
    const a = compat.check(id);
    const b = compat.check(id);
    expect(a).toBe(b);
    const [r1, ra, rb] = await Promise.all([first, a, b]);
    await quiet(compat);
    expect(checks(fake)).toBe(before + 2);
    expect(ra).toBe(rb);
    expect(ra.checkedAt).toBeGreaterThanOrEqual(r1.checkedAt);
    expect(ra).not.toBe(r1);
  });

  it('19. a new token is used at once (no cached client)', async () => {
    const { compat, fake, id, store, inst } = setup({ dbInstances: true });
    await compat.check(id);
    store.save({ ...inst, dashboardToken: 'nouveau-jeton-du-dashboard' });
    fake.auth.dashToken = 'nouveau-jeton-du-dashboard';
    await callOp(compat.http(id), compat.get(id), 'kanban', 'board', { query: { board: 'default' } });
    expect(fake.requests.at(-1)!.authorization).toBe('Bearer nouveau-jeton-du-dashboard');
  });

  it('20. ticks run instances in parallel, a tick during a tick returns at once', async () => {
    const dataDir = tempDir();
    const a = fakeInstance();
    const b = fakeInstance({ id: 'fige', label: 'Figé', api: 'http://fige-api', dashboard: 'http://fige-dash' });
    const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_INSTANCES: JSON.stringify([a, b]) });
    const db = openDb(dataDir);
    const store = new InstanceStore(db, config);
    const fa = createFakeHermes({ fixturesDir: FIXTURES, filesRoot: tempDir() });
    const fb = createFakeHermes({ fixturesDir: FIXTURES, filesRoot: tempDir() });
    let frozen = false;
    let thaw = () => {};
    const gate = new Promise<void>((r) => { thaw = r; });
    const fbFetch = fakeFetch(fb, { api: 'fige-api', dash: 'fige-dash' });
    const fetchImpl = combineFetch([
      { hosts: { api: 'fake-api', dash: 'fake-dash' }, fetch: fakeFetch(fa) },
      { hosts: { api: 'fige-api', dash: 'fige-dash' }, fetch: (async (input: string, init: RequestInit) => {
        if (frozen) await gate;
        return fbFetch(input, init);
      }) as ReturnType<typeof fakeFetch> },
    ]);
    const compat = new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl, fakeWebSocketFactory(fa));
    services.push(compat);
    // no report: the tick runs a full check of each
    frozen = true;
    const tick = compat.tick();
    for (let i = 0; i < 500 && !compat.get('fake'); i++) await new Promise((r) => setImmediate(r));
    expect(compat.get('fake')).toBeDefined();
    expect(compat.get('fige')).toBeUndefined();
    const t0 = Date.now();
    await compat.tick();
    expect(Date.now() - t0).toBeLessThan(50);
    frozen = false;
    thaw();
    await tick;
    expect(compat.get('fige')).toBeDefined();
  });

  it('21. an unreadable stored report is ignored at boot', async () => {
    const first = setup();
    await first.compat.check(first.id);
    const row = first.db.select().from(compatReports).where(eq(compatReports.instanceId, first.id)).get()!;
    first.db.update(compatReports).set({ reportJson: '{' }).where(eq(compatReports.id, row.id)).run();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const again = setup({ db: first.db, dataDir: first.dataDir });
    expect(again.compat.get(first.id)).toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('unreadable'))).toBe(true);
  });

  it('22. a check whose probes all fail counts once: checks never signal themselves', async () => {
    fakeTimers();
    const { compat, fake, id } = setup();
    fake.down.add('api');
    fake.down.add('dash');
    await compat.check(id);
    await quiet(compat);
    expect(compat.get(id)!.outage).toMatchObject({ api: true, dash: true });
    expect((compat as unknown as { lastRequest: Map<string, unknown> }).lastRequest.size).toBe(0);
    expect(follow(compat, id)!.checks).toBe(0);
  });
});

