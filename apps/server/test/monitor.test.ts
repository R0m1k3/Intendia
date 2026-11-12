import { describe, expect, it } from 'vitest';
import { FAKE_SECRETS } from 'fake-hermes';
import { testApp } from './helpers.js';

const M = '/x/i/fake/monitor';

describe('monitor: usage', () => {
  it('returns totals, days, models, tools, skills and sources', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${M}/usage?days=7`);
    expect(res.status).toBe(200);
    const u = res.json;
    expect(u.days).toBe(7);
    expect(u.daily.length).toBeGreaterThan(0);
    expect(u.totals.input).toBeGreaterThan(0);
    expect(u.totals.reasoning).toBeNull();
    expect(u.byModel).toHaveLength(3);
    expect(u.tools[0]).toEqual({ name: 'terminal', count: 40, percentage: 40 });
    expect(u.skills[0].name).toBe('fake/recherche-web');
    expect(u.sources).toEqual({ api_server: 30, cli: 8, cron: 4 });
    expect(u.partial).toEqual([]);
    expect(t.fake.monitor.calls.find((c) => c.path === '/api/analytics/usage' && c.query.days === '7')).toBeTruthy();
  });

  it('refuses a period outside 7/30/90 without calling Hermes', async () => {
    const t = await testApp();
    const before = t.fake.monitor.calls.length;
    expect((await t.request('GET', `${M}/usage?days=5`)).status).toBe(400);
    expect(t.fake.monitor.calls.length).toBe(before);
  });

  it('reports a failed session stats call as partial', async () => {
    const t = await testApp({ breaks: { 'dash GET /api/sessions/stats': { status: 500 } } });
    const u = (await t.request('GET', `${M}/usage?days=30`)).json;
    expect(u.sources).toBeNull();
    expect(u.partial).toEqual(['sources']);
  });

  it('sends the profile', async () => {
    const t = await testApp();
    await t.request('GET', `${M}/usage?days=30&profile=recherche`);
    const req = t.fake.requests.filter((r) => r.path === '/api/analytics/usage').at(-1)!;
    expect(req.query.profile).toBe('recherche');
  });
});

describe('monitor: logs', () => {
  it('masks secrets, known config values and host paths', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${M}/logs?file=mcp&lines=500`);
    expect(res.status).toBe(200);
    const body = res.json;
    const text = (body.lines as string[]).join('\n');
    expect(body.unredacted).toBe(true);
    expect(text).not.toContain('sk-test-leak');
    expect(text).not.toContain(FAKE_SECRETS.plain);
    expect(text).toContain('«secret:');
    expect(text).not.toContain('/opt/data/profiles');
    expect(text).toContain('…/config.yaml');
  });

  it('filters by level, component and search', async () => {
    const t = await testApp();
    const err = (await t.request('GET', `${M}/logs?file=agent&level=ERROR&lines=100`)).json;
    expect(err.lines.length).toBeGreaterThan(0);
    expect(err.lines.every((l: string) => l.includes(' ERROR '))).toBe(true);
    const cron = (await t.request('GET', `${M}/logs?file=agent&component=cron&lines=100`)).json;
    expect(cron.lines.every((l: string) => l.includes('[cron]') && !l.endsWith('\n'))).toBe(true);
    const s = (await t.request('GET', `${M}/logs?file=agent&search=ligne%2042&lines=100`)).json;
    expect(s.lines.some((l: string) => l.includes('ligne 42'))).toBe(true);
  });

  it('refuses unknown file, level, component or line count before calling Hermes', async () => {
    const t = await testApp();
    const before = t.fake.monitor.calls.length;
    for (const q of ['file=passwd', 'lines=300', 'level=TRACE', 'component=kernel', `search=${'x'.repeat(201)}`]) {
      expect((await t.request('GET', `${M}/logs?${q}`)).status, q).toBe(400);
    }
    expect(t.fake.monitor.calls.length).toBe(before);
  });

  it('masks a Hermes error', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${M}/logs?file=agent&search=panne`);
    expect(res.status).toBe(502);
    const body = res.json;
    expect(body.error).not.toContain('/opt/data/logs');
  });
});

describe('monitor: system', () => {
  it('keeps only the listed fields and caches 5 s', async () => {
    const t = await testApp();
    const sys = () => t.fake.monitor.calls.filter((c) => c.path === '/api/system/stats').length;
    const before = sys(); // the compatibility probe
    const s = (await t.request('GET', `${M}/system`)).json;
    expect(s.psutil).toBe(true);
    expect(s.memory.total).toBe(16 * 2 ** 30);
    expect(s.hostname).toBe('fake-hermes-host');
    expect(s).not.toHaveProperty('python_impl');
    await t.request('GET', `${M}/system`);
    expect(sys()).toBe(before + 1);
  });

  it('without psutil: identity and load only', async () => {
    const t = await testApp({ monitor: { psutil: false } });
    const s = (await t.request('GET', `${M}/system`)).json;
    expect(s.psutil).toBe(false);
    expect(s.memory).toBeNull();
    expect(s.loadAvg).toEqual([0.42, 0.37, 0.3]);
  });
});

describe('monitor: compat', () => {
  it('is unavailable without the usage route, logs alone hidden without /api/logs', async () => {
    const t = await testApp({ hide: { openapi: ['GET /api/analytics/usage'] } });
    const report = ((await t.request('GET', '/x/compat')).json).reports[0];
    expect(report.modules.find((m: { id: string }) => m.id === 'monitor').state).toBe('unavailable');
    const t2 = await testApp({ hide: { openapi: ['GET /api/logs'] } });
    const r2 = ((await t2.request('GET', '/x/compat')).json).reports[0];
    const mod = r2.modules.find((m: { id: string }) => m.id === 'monitor');
    expect(mod.state).toBe('full');
    expect(mod.ops.logs.ok).toBe(false);
  });
});
