import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const C = '/x/i/fake/config/mcp';
const PUBLIC = 'https://intendia.example.test';
type T = Awaited<ReturnType<typeof testApp>>;
const ours = (name: string) => `${PUBLIC}/x/mcp-oauth/fake/${name}/callback`;
const callbacks = (t: T) => t.fake.config.mcpCatalog.callbacks;
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
const page = (t: T, path: string, headers: Record<string, string> = {}) => t.rawRequest('GET', path, { cookie: false, csrf: false, headers });
const yaml = async (t: T) => (await t.request('GET', '/x/i/fake/config/raw')).json.yaml as string;

describe('mcp catalog', () => {
  it('lists the catalog masked, doc links in https only, with the relay state', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${C}/catalog`);
    expect(res.status).toBe(200);
    expect(res.json.entries.map((e: any) => e.name)).toEqual(['notes-cloud', 'taches-pro', 'docs-libres']);
    expect(res.json.entries[0]).toMatchObject({ auth: 'oauth', docsUrl: 'https://notes.example.test/docs/mcp', installed: false });
    expect(res.json.entries[2].docsUrl).toBeNull();
    expect(res.json.entries[1].requiredEnv.map((e: any) => e.name)).toEqual(['TACHES_CLIENT_ID', 'TACHES_CLIENT_SECRET']);
    expect(res.json.diagnostics).toEqual(['casse : manifest casse.yaml: missing url']);
    expect(res.json.relay).toBe(false);
  });

  it('installs an entry with its declared variables only, values not echoed', async () => {
    const t = await testApp();
    const bad = await t.request('POST', `${C}/catalog/taches-pro`, { env: { TACHES_CLIENT_ID: 'id-1', OTHER_KEY: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('OTHER_KEY');
    const missing = await t.request('POST', `${C}/catalog/taches-pro`, { env: { TACHES_CLIENT_ID: 'id-1' } });
    expect(missing.status).toBe(400);
    expect(missing.json.error).toContain('TACHES_CLIENT_SECRET');
    expect(t.fake.requests.some((r) => r.path === '/api/mcp/catalog/install')).toBe(false);
    const ok = await t.request('POST', `${C}/catalog/taches-pro`, { env: { TACHES_CLIENT_ID: 'id-1', TACHES_CLIENT_SECRET: 'tres-secret-valeur-42' } });
    expect(ok.status).toBe(201);
    expect(ok.json.background).toBe(false);
    expect(JSON.stringify(ok.json)).not.toContain('tres-secret-valeur-42');
    expect(t.fake.config.envValues.get('TACHES_CLIENT_SECRET')).toBe('tres-secret-valeur-42');
    expect((await t.request('GET', `${C}/catalog`)).json.entries[1].installed).toBe(true);
    expect((await t.request('POST', `${C}/catalog/taches-pro`, { env: {} })).json.code).toBe('already_installed');
    expect((await t.request('POST', `${C}/catalog/inconnu`, { env: {} })).status).toBe(404);
    // a copy of the file before the write, as for every MCP change
    expect((await t.request('GET', '/x/i/fake/config/versions')).json.versions[0].source).toBe('mcp');
  });
});

describe('mcp oauth', () => {
  it('without a public URL, refuses with no_public_url', async () => {
    const t = await testApp();
    await t.request('POST', `${C}/catalog/notes-cloud`, { env: {} });
    const res = await t.request('POST', `${C}/notes-cloud/connect`);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('no_public_url');
    expect(t.fake.requests.some((r) => r.path.endsWith('/auth'))).toBe(false);
  });

  it('writes its return URL, relays the callback once, then the flow is approved', async () => {
    const t = await testApp({ env: { INTENDIA_PUBLIC_URL: PUBLIC } });
    expect((await t.request('GET', `${C}/catalog`)).json.relay).toBe(true);
    await t.request('POST', `${C}/catalog/notes-cloud`, { env: {} });
    const res = await t.request('POST', `${C}/notes-cloud/connect`);
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe('relay');
    expect(res.json.flow.status).toBe('authorization_required');
    expect(await yaml(t)).toContain(ours('notes-cloud'));
    expect(decodeURIComponent(res.json.flow.authorizationUrl)).toContain(ours('notes-cloud'));
    const state = stateOf(res.json.flow.authorizationUrl);

    // a state Intendia did not start: 404, nothing sent to Hermes
    const other = await page(t, `/x/mcp-oauth/fake/notes-cloud/callback?code=c&state=autre-serveur`);
    expect(other.status).toBe(404);
    // the right state on another server name: 404 too, and the true return still passes afterwards
    expect((await page(t, `/x/mcp-oauth/fake/docs-libres/callback?code=c&state=${state}`)).status).toBe(404);
    expect(callbacks(t)).toHaveLength(0);

    const back = await page(t, `/x/mcp-oauth/fake/notes-cloud/callback?code=code-123&state=${state}`);
    expect(back.status).toBe(200);
    expect(back.headers.get('content-security-policy')).toContain("default-src 'none'");
    const body = await back.text();
    expect(body).toContain('Connexion terminée');
    expect(body).not.toContain('Authorization received');
    expect(callbacks(t)).toEqual([{ server: 'notes-cloud', code: 'code-123', state }]);
    const cb = t.fake.requests.find((r) => r.path === '/api/mcp/oauth/callback/notes-cloud')!;
    expect(cb.authorization).toBeUndefined();
    expect(cb.headers.cookie).toBeUndefined();

    // a second callback of the same flow is not relayed
    expect((await page(t, `/x/mcp-oauth/fake/notes-cloud/callback?code=code-123&state=${state}`)).status).toBe(404);
    expect(callbacks(t)).toHaveLength(1);

    const f = await t.request('GET', `${C}/flows/${res.json.flow.id}`);
    expect(f.json).toMatchObject({ status: 'approved', tools: ['notes-cloud_search'] });
  });

  it('keeps a redirect_uri set by hand: no relay', async () => {
    const t = await testApp({ env: { INTENDIA_PUBLIC_URL: PUBLIC } });
    await t.request('POST', `${C}/catalog/notes-cloud`, { env: {} });
    const raw = await t.request('GET', '/x/i/fake/config/raw');
    const text = (raw.json.yaml as string).replace(/(notes-cloud:\n(?: {4}.*\n)*)/, `$1    oauth:\n      redirect_uri: https://moi.example.test/retour\n`);
    expect((await t.request('PUT', '/x/i/fake/config/raw', { yaml: text, version: raw.json.version })).status).toBe(200);
    const res = await t.request('POST', `${C}/notes-cloud/connect`);
    expect(res.json.mode).toBe('custom');
    expect(await yaml(t)).toContain('https://moi.example.test/retour');
    const state = stateOf(res.json.flow.authorizationUrl);
    expect((await page(t, `/x/mcp-oauth/fake/notes-cloud/callback?code=c&state=${state}`)).status).toBe(404);
    expect(callbacks(t)).toHaveLength(0);
  });

  it('cancels a flow', async () => {
    const t = await testApp({ env: { INTENDIA_PUBLIC_URL: PUBLIC } });
    await t.request('POST', `${C}/catalog/notes-cloud`, { env: {} });
    const id = (await t.request('POST', `${C}/notes-cloud/connect`)).json.flow.id;
    expect((await t.request('DELETE', `${C}/flows/${id}`)).status).toBe(200);
    expect((await t.request('GET', `${C}/flows/${id}`)).json).toMatchObject({ status: 'error', error: 'Cancelled by user' });
  });

  it('checks the callback: name, parameters, rate limit; no session needed', async () => {
    const t = await testApp({ env: { INTENDIA_PUBLIC_URL: PUBLIC } });
    expect((await page(t, '/x/mcp-oauth/fake/..%2Fx/callback?code=c&state=s')).status).toBe(400);
    expect((await page(t, '/x/mcp-oauth/fake/notes-cloud/callback?state=s')).status).toBe(400);
    expect((await page(t, `/x/mcp-oauth/fake/notes-cloud/callback?code=c&state=${'s'.repeat(3000)}`)).status).toBe(400);
    const ip = { 'X-Forwarded-For': '10.9.9.9' };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await page(t, '/x/mcp-oauth/fake/notes-cloud/callback?code=c&state=s', ip)).status);
    expect(codes.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(codes[10]).toBe(429);
    expect(callbacks(t)).toHaveLength(0);
  });
});
