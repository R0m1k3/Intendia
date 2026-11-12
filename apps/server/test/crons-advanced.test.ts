import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/crons';
type T = Awaited<ReturnType<typeof testApp>>;
const input = (over: Record<string, unknown> = {}) => ({
  name: 'Rapport', prompt: 'Fais le rapport.', schedule: '30 8 * * 1', deliver: 'local', skills: [], model: null, workspace: null, ...over,
});
const dashCalls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path.startsWith(path));

describe('crons: advanced options (lot 8 C)', () => {
  it('sends the advanced options on create and reads them back', async () => {
    const t = await testApp();
    const first = (await t.request('POST', BASE, input({ name: 'Source' }))).json.cron;
    const res = await t.request('POST', BASE, input({
      repeat: 3, timezone: 'Europe/Paris', enabledToolsets: ['web', 'terminal'], catchUp: false, graceMinutes: 15, contextFrom: [first.id],
    }));
    expect(res.status).toBe(201);
    expect(res.json.cron).toMatchObject({ repeat: 3, timezone: 'Europe/Paris', enabledToolsets: ['web', 'terminal'], catchUp: false, graceMinutes: 15, contextFrom: [first.id] });
    expect(dashCalls(t, 'POST', '/api/cron/jobs').at(-1)!.body).toMatchObject({ repeat: 3, timezone: 'Europe/Paris', enabled_toolsets: ['web', 'terminal'], catch_up: false, grace_minutes: 15, context_from: [first.id] });
  });

  it('empty options are not sent on create; [] toolsets never sent', async () => {
    const t = await testApp();
    await t.request('POST', BASE, input({ repeat: 'forever', timezone: null, enabledToolsets: [], catchUp: null, graceMinutes: null, contextFrom: [] }));
    const body = dashCalls(t, 'POST', '/api/cron/jobs').at(-1)!.body as Record<string, unknown>;
    for (const k of ['repeat', 'timezone', 'enabled_toolsets', 'catch_up', 'grace_minutes', 'context_from']) expect(body).not.toHaveProperty(k);
  });

  it('update: emptied options go back to Hermes defaults (null, forever); absent ones are unchanged', async () => {
    const t = await testApp();
    const c = (await t.request('POST', BASE, input({ repeat: 3, timezone: 'Europe/Paris', enabledToolsets: ['web'], catchUp: true, graceMinutes: 5 }))).json.cron;
    const kept = await t.request('PUT', `${BASE}/${c.id}?profile=default`, input({ name: 'Renommé' }));
    expect(kept.json.cron).toMatchObject({ repeat: 3, timezone: 'Europe/Paris', enabledToolsets: ['web'], catchUp: true, graceMinutes: 5 });
    const reset = await t.request('PUT', `${BASE}/${c.id}?profile=default`, input({ repeat: 'forever', timezone: null, enabledToolsets: [], catchUp: null, graceMinutes: null, contextFrom: [] }));
    expect(reset.status).toBe(200);
    const updates = (dashCalls(t, 'PUT', '/api/cron/jobs/').at(-1)!.body as { updates: Record<string, unknown> }).updates;
    expect(updates).toMatchObject({ repeat: 'forever', timezone: null, enabled_toolsets: null, catch_up: null, grace_minutes: null, context_from: null });
    expect(reset.json.cron).toMatchObject({ repeat: null, timezone: null, enabledToolsets: null, catchUp: null, graceMinutes: null, contextFrom: [] });
  });

  it('refuses an unknown context cron before Hermes, and a bad time zone', async () => {
    const t = await testApp();
    const r = await t.request('POST', BASE, input({ contextFrom: ['abcdef'] }));
    expect(r.status).toBe(400);
    expect(dashCalls(t, 'POST', '/api/cron/jobs')).toHaveLength(0);
    expect((await t.request('POST', BASE, input({ timezone: 'pas une zone' }))).status).toBe(400);
  });
});

describe('crons: blueprints (lot 8 C)', () => {
  it('lists the templates without their prompt', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${BASE}/blueprints?profile=default`);
    expect(res.status).toBe(200);
    const bps = res.json.blueprints;
    expect(bps.map((b: any) => b.key)).toEqual(['morning-brief', 'price-watch', 'plugin-x']);
    expect(bps[0].fields).toEqual([
      { name: 'time', type: 'time', label: 'Time', default: '08:00', options: [], optional: false, help: 'When to send it' },
      { name: 'style', type: 'select', label: 'Style', default: 'short', options: [{ value: 'short', label: 'Short' }, { value: 'detailed', label: 'Detailed' }], optional: false, help: null },
    ]);
    expect(bps[2]).toMatchObject({ source: 'plugin', plugin: 'fake-plugin' });
    expect(JSON.stringify(bps)).not.toMatch(/appUrl|command|prompt/);
  });

  it('instantiates with an explicit profile, then frames it in a workspace', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'ws', name: 'Ws', instanceId: 'fake' });
    const res = await t.request('POST', `${BASE}/blueprints/morning-brief?profile=default`, { values: { time: '07:30' }, workspace: 'ws' });
    expect(res.status).toBe(201);
    expect(res.json.attached).toBe(true);
    expect(res.json.cron.workspace).toMatchObject({ slug: 'ws' });
    expect(res.json.cron.schedule.expr).toBe('30 7 * * *');
    const inst = dashCalls(t, 'POST', '/api/cron/blueprints/instantiate').at(-1)!;
    expect(inst.query).toEqual({ profile: 'default' });
    expect(inst.body).toEqual({ blueprint: 'morning-brief', values: { time: '07:30' } });
    const upd = (dashCalls(t, 'PUT', '/api/cron/jobs/').at(-1)!.body as { updates: { prompt: string; workdir: string } }).updates;
    expect(upd.prompt).toContain('[Intendia]');
    expect(upd.workdir).toBeTruthy();
  });

  it('without workspace: one call; unknown field 400; a failed framing leaves the cron unattached', async () => {
    const t = await testApp({ breaks: { 'dash PUT /api/cron/jobs/a00000000002': { status: 500 } } });
    const plain = await t.request('POST', `${BASE}/blueprints/price-watch?profile=default`, { values: { url: 'https://example.com/p' } });
    expect(plain.json).toMatchObject({ attached: false, cron: { workspace: null } });
    expect(dashCalls(t, 'PUT', '/api/cron/jobs/')).toHaveLength(0);
    expect((await t.request('POST', `${BASE}/blueprints/price-watch?profile=default`, { values: { autre: 'x' } })).status).toBe(400);
    await t.request('POST', '/x/workspaces', { slug: 'ws', name: 'Ws', instanceId: 'fake' });
    const broken = await t.request('POST', `${BASE}/blueprints/plugin-x?profile=default`, { values: {}, workspace: 'ws' });
    expect(broken.status).toBe(201);
    expect(broken.json.attached).toBe(false);
    expect((await t.request('POST', `${BASE}/blueprints/plugin-x`, { values: {} })).status).toBe(400);
  });
});
