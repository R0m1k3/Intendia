import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompatService } from '../src/compat/service.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { compatReports } from '../src/db/schema.js';
import { InstanceStore } from '../src/instances/store.js';
import { callOp, ModuleUnavailableError } from '../src/connectors/runtime.js';
import { fakeHttp, fakeInstance, tempDir } from './helpers.js';

// checkInstance stays the real one unless a test asks it to fail
const failNext = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/compat/engine.js', async (orig) => {
  const real = await orig<typeof import('../src/compat/engine.js')>();
  return {
    ...real,
    checkInstance: async (...args: Parameters<typeof real.checkInstance>) => {
      if (failNext.count > 0) { failNext.count--; throw new Error('réponse inattendue du sondage'); }
      return real.checkInstance(...args);
    },
  };
});

function setup() {
  const dataDir = tempDir();
  const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_INSTANCES: JSON.stringify([fakeInstance()]) });
  const db = openDb(dataDir);
  const store = new InstanceStore(db, config);
  const { fetchImpl } = fakeHttp();
  const make = () => new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl);
  return { db, make, id: fakeInstance().id };
}

/** Rewrites the stored report as an older Intendia would have saved it: without `config.oauthList`. */
function dropOp(db: ReturnType<typeof openDb>, id: string) {
  const row = db.select().from(compatReports).where(eq(compatReports.instanceId, id)).get()!;
  const report = JSON.parse(row.reportJson);
  delete report.modules.find((m: { id: string }) => m.id === 'config').ops.oauthList;
  db.update(compatReports).set({ reportJson: JSON.stringify(report) }).where(eq(compatReports.id, row.id)).run();
}

afterEach(() => {
  vi.restoreAllMocks();
  failNext.count = 0;
});

describe('compat report saved by an older Intendia', () => {
  it('lists the unknown ops as unchecked and rechecks them at the next tick', async () => {
    const { db, make, id } = setup();
    await make().check(id);
    dropOp(db, id);
    const compat = make();
    const old = compat.get(id)!;
    expect(old.unchecked).toEqual(['config.oauthList']);
    expect(compat.get(id)).toBe(old);
    const err = await callOp<never>(compat.http(id), old, 'config', 'oauthList').catch((e: unknown) => e as ModuleUnavailableError);
    expect(err).toBeInstanceOf(ModuleUnavailableError);
    expect(err.message).toBe('config.oauthList pas encore vérifié sur cette instance');
    // stored report untouched
    expect(db.select().from(compatReports).all().some((r) => r.reportJson.includes('unchecked'))).toBe(false);

    await compat.tick();
    const fresh = compat.get(id)!;
    expect(fresh.unchecked).toBeUndefined();
    expect(fresh.modules.find((m) => m.id === 'config')!.ops.oauthList!.ok).toBe(true);
  });

  it('logs a failed check, shows it, retries it at the next tick and clears it on success', async () => {
    const { db, make, id } = setup();
    await make().check(id);
    const compat = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failNext.count = 1;
    await expect(compat.check(id)).rejects.toThrow('réponse inattendue');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('compat check of instance "fake" failed: réponse inattendue');
    expect(compat.get(id)!.checkError).toBe('réponse inattendue du sondage');

    // complete report, same version, < 24 h: only the error makes the tick recheck
    await compat.tick();
    expect(compat.get(id)!.checkError).toBeUndefined();
  });

  it('a failure after a version change is logged once per tick', async () => {
    const { make, id } = setup();
    const compat = make();
    await compat.check(id);
    compat.get(id)!.hermesVersion = 'ancienne';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    failNext.count = 2;
    await compat.tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(compat.get(id)!.checkError).toBe('réponse inattendue du sondage');
  });

  it('marks the report as checking in all() while a check runs, without copying get()', async () => {
    const { make, id } = setup();
    const compat = make();
    await compat.check(id);
    const before = compat.get(id);
    const running = compat.check(id);
    expect(compat.all()[0]!.checking).toBe(true);
    expect(compat.get(id)).toBe(before);
    await running;
    expect(compat.all()[0]!.checking).toBeUndefined();
  });

  it('unknown op of a failed check gives the error as reason', async () => {
    const { db, make, id } = setup();
    await make().check(id);
    dropOp(db, id);
    const compat = make();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failNext.count = 1;
    await compat.check(id).catch(() => undefined);
    const err = await callOp<never>(compat.http(id), compat.get(id), 'config', 'oauthList').catch((e: unknown) => e as ModuleUnavailableError);
    expect(err.reasons).toEqual(['Vérification échouée : réponse inattendue du sondage']);
  });
});
