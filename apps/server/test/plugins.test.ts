import { describe, expect, it } from 'vitest';
import { FAKE_PLUGIN_CATALOG } from 'fake-hermes';
import { testApp } from './helpers.js';

const P = '/x/i/fake/plugins';
type T = Awaited<ReturnType<typeof testApp>>;
const installs = (t: T) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === 'POST' && r.path === '/api/dashboard/agent-plugins/install');
const waitJob = async (t: T, id: string) => {
  for (let i = 0; i < 100; i++) {
    const j = (await t.request('GET', `${P}/jobs/${id}`)).json;
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('job still running');
};

describe('plugins: list and catalog', () => {
  it('lists the installed plugins without their host path, the auth command masked', async () => {
    const t = await testApp();
    const res = await t.request('GET', P);
    expect(res.status).toBe(200);
    expect(res.json.plugins.map((p: any) => p.name)).toEqual(['memory-honcho', 'browser-local', 'meteo-locale']);
    const s = JSON.stringify(res.json);
    expect(s).not.toContain('/opt/data/plugins');
    expect(s).not.toContain('"path"');
    expect(s).not.toContain('fake-plugin-token-0987654321');
    expect(res.json.plugins[2]).toMatchObject({ canRemove: true, authRequired: true, status: 'enabled', source: 'git' });
    expect(res.json.plugins[0]).toMatchObject({ canRemove: false, status: 'inactive' });
    expect(res.json.plugins[2].authCommand).toMatch(/^hermes plugins auth meteo-locale --token «secret:[0-9a-f]{8}»$/);
  });

  it('gives the catalog without the withdrawn entries, with capabilities and update state', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${P}/catalog`);
    expect(res.status).toBe(200);
    expect(res.json.entries.map((e: any) => e.name)).toEqual(FAKE_PLUGIN_CATALOG.map((e) => e.name));
    expect(res.json.removed).toEqual([{ name: 'ancien', reason: 'Remplacé par notes-rapides.' }]);
    const plus = res.json.entries.find((e: any) => e.name === 'capacites-elargies');
    expect(plus).toMatchObject({ title: 'capacites-elargies', tools: ['web_fetch_plus'], hooks: ['on_message'], middleware: ['rewrite'], requiresEnv: ['PLUS_API_KEY'], shaShort: 'bbbbbbb', installed: false });
    expect(res.json.entries.find((e: any) => e.name === 'meteo-locale')).toMatchObject({ installed: true, updateAvailable: true });
    expect(JSON.stringify(res.json)).not.toContain('long readme');
    expect(JSON.stringify(res.json)).not.toContain('github.com/fake/notes-rapides"');
  });

  it('is unavailable without the hub; the catalog is optional', async () => {
    const t = await testApp({ hide: { openapi: ['GET /api/dashboard/plugins/catalog'] } });
    expect((await t.request('GET', P)).status).toBe(200);
    expect((await t.request('GET', `${P}/catalog`)).status).toBe(409);
  });
});

describe('plugins: install', () => {
  it('installs a catalog entry by name in the background, with its repository and pinned commit', async () => {
    const t = await testApp({ pluginInstallMs: 50 });
    const res = await t.request('POST', `${P}/install`, { name: 'notes-rapides' });
    expect(res.status).toBe(202);
    expect(res.json.job).toMatchObject({ name: 'notes-rapides', state: 'running' });
    expect((await t.request('GET', `${P}/jobs`)).json.job.id).toBe(res.json.job.id);
    const busy = await t.request('POST', `${P}/install`, { name: 'scan-refuse' });
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe('busy');
    const job = await waitJob(t, res.json.job.id);
    expect(job.state).toBe('done');
    expect(job.result).toMatchObject({ state: 'installed', plugin: 'notes-rapides', enabled: true, restartRequired: true, missingEnv: [] });
    expect(JSON.stringify(job)).not.toContain('/opt/data/plugins');
    expect(installs(t).map((r) => r.body)).toEqual([{ identifier: 'https://github.com/fake/notes-rapides', ref: 'a'.repeat(40), catalog_name: 'notes-rapides', enable: true, force: false }]);
    expect((await t.request('GET', `${P}/jobs`)).json.job).toBeNull();
    expect((await t.request('GET', P)).json.plugins.map((p: any) => p.name)).toContain('notes-rapides');
    const again = await t.request('POST', `${P}/install`, { name: 'notes-rapides' });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('already_installed');
  });

  it('refuses a name outside the catalog, a withdrawn entry and an installed one without calling Hermes', async () => {
    const t = await testApp({ pluginInstallMs: 10 });
    expect((await t.request('POST', `${P}/install`, { name: 'inconnu' })).status).toBe(404);
    expect((await t.request('POST', `${P}/install`, { name: 'ancien' })).status).toBe(404);
    expect((await t.request('POST', `${P}/install`, { name: '../x' })).status).toBe(400);
    expect((await t.request('POST', `${P}/install`, { name: 'meteo-locale' })).json.code).toBe('already_installed');
    expect(installs(t)).toHaveLength(0);
  });

  it('reports consent and a blocked scan, masked, as job results', async () => {
    const t = await testApp({ pluginInstallMs: 10 });
    const c = await waitJob(t, (await t.request('POST', `${P}/install`, { name: 'capacites-elargies' })).json.job.id);
    expect(c).toMatchObject({ state: 'done', result: { state: 'consent' } });
    expect(c.result.message).toContain('not covered');
    const b = await waitJob(t, (await t.request('POST', `${P}/install`, { name: 'scan-refuse' })).json.job.id);
    expect(b.state).toBe('failed');
    expect(b.error).toContain('Security scan blocked');
    expect(b.error).not.toContain('/opt/data/plugins');
  });

  it('answers 404 for an unknown job and for a job of another instance', async () => {
    const t = await testApp({ pluginInstallMs: 10, extra: [{ id: 'autre' }] });
    expect((await t.request('GET', `${P}/jobs/nope`)).status).toBe(404);
    const id = (await t.request('POST', `${P}/install`, { name: 'notes-rapides' })).json.job.id;
    expect((await t.request('GET', `/x/i/autre/plugins/jobs/${id}`)).status).toBe(404);
    await waitJob(t, id);
  });
});

describe('plugins: enable, disable, remove', () => {
  it('disables and enables a plugin', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${P}/browser-local/disable`)).status).toBe(200);
    expect((await t.request('GET', P)).json.plugins[1].status).toBe('disabled');
    expect((await t.request('POST', `${P}/browser-local/enable`)).status).toBe(200);
    expect((await t.request('GET', P)).json.plugins[1].status).toBe('enabled');
    expect((await t.request('POST', `${P}/absent/enable`)).status).toBe(400);
  });

  it('removes a user plugin, refuses a bundled one', async () => {
    const t = await testApp();
    const bundled = await t.request('DELETE', `${P}/memory-honcho`);
    expect(bundled.status).toBe(409);
    expect(bundled.json.code).toBe('protected');
    expect((await t.request('DELETE', `${P}/absent`)).status).toBe(404);
    expect((await t.request('DELETE', `${P}/meteo-locale`)).status).toBe(200);
    expect((await t.request('GET', P)).json.plugins.map((p: any) => p.name)).not.toContain('meteo-locale');
    expect(t.fake.requests.filter((r) => r.method === 'DELETE' && r.path.startsWith('/api/dashboard/agent-plugins/')).map((r) => r.path)).toEqual(['/api/dashboard/agent-plugins/meteo-locale']);
  });
});
