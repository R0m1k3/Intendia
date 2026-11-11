import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/config';
const TOKEN = 'sk-ant-oat01-TESTtoken-abcdefghijklmnop';
type T = Awaited<ReturnType<typeof testApp>>;

const anthropic = async (t: T) => ((await t.request('GET', `${BASE}/providers`)).json.accounts as any[]).find((a) => a.id === 'anthropic');
const env = (t: T) => t.fake.config.envValues;
const envCopies = async (t: T) => ((await t.request('GET', `${BASE}/versions`)).json.versions as any[]).filter((v) => v.source === 'env').length;

describe('Anthropic subscription token (claude setup-token)', () => {
  it('saves the trimmed token in ANTHROPIC_TOKEN; the card is connected and the models follow; never sent back', async () => {
    const t = await testApp();
    const groups = async () => ((await t.request('GET', '/x/i/fake/chat-models')).json.groups as { provider: string }[]).map((g) => g.provider);
    expect(await groups()).not.toContain('anthropic');
    const r = await t.request('POST', `${BASE}/providers/anthropic/token`, { token: `  ${TOKEN}\n` });
    expect(r.status).toBe(200);
    expect(r.json.restartNeeded).toBe(false);
    expect(env(t).get('ANTHROPIC_TOKEN')).toBe(TOKEN);
    expect(await anthropic(t)).toMatchObject({ connected: true, via: 'token' });
    expect(await groups()).toContain('anthropic');
    const list = await t.request('GET', `${BASE}/providers`);
    expect(JSON.stringify(list.json)).not.toContain(TOKEN);
    expect(JSON.stringify(list.json)).not.toMatch(/source_label|env_var/);
    expect(await envCopies(t)).toBe(1);
  });

  it('refuses an API key and anything that is not a setup-token, writing nothing', async () => {
    const t = await testApp();
    const api = await t.request('POST', `${BASE}/providers/anthropic/token`, { token: 'sk-ant-api03-abcdefghijklmnopqrstuv' });
    expect(api.status).toBe(400);
    expect(api.json.code).toBe('api_key_given');
    for (const token of ['sk-ant-admin01-abcdefghijklmnopqrst', 'sk-ant-oat01 abc defghijklmnopqrst', 'sk-ant-oat01', `sk-ant-oat01-${'x'.repeat(4100)}`]) {
      const r = await t.request('POST', `${BASE}/providers/anthropic/token`, { token });
      expect(r.status, token.slice(0, 20)).toBe(400);
      expect(r.json.code).toBe('invalid_token');
      expect(JSON.stringify(r.json)).not.toContain('abcdefghijklmnop');
    }
    expect(env(t).has('ANTHROPIC_TOKEN')).toBe(false);
  });

  it('API key present: 409 without writing; with consent the key is deleted after the token', async () => {
    const t = await testApp();
    env(t).set('ANTHROPIC_API_KEY', 'sk-ant-api03-existing');
    expect(await anthropic(t)).toMatchObject({ connected: false, via: 'api_key' });
    const before = await envCopies(t);
    const r = await t.request('POST', `${BASE}/providers/anthropic/token`, { token: TOKEN });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('api_key_present');
    expect(env(t).has('ANTHROPIC_TOKEN')).toBe(false);
    expect(env(t).get('ANTHROPIC_API_KEY')).toBe('sk-ant-api03-existing');
    expect(await envCopies(t)).toBe(before);
    const ok = await t.request('POST', `${BASE}/providers/anthropic/token`, { token: TOKEN, replaceApiKey: true });
    expect(ok.status).toBe(200);
    expect(ok.json.restartNeeded).toBe(true);
    expect(env(t).get('ANTHROPIC_TOKEN')).toBe(TOKEN);
    expect(env(t).has('ANTHROPIC_API_KEY')).toBe(false);
    expect(await anthropic(t)).toMatchObject({ connected: true, via: 'token' });
  });

  it('the key cannot be deleted: partial write (502); already gone (404): success', async () => {
    const t = await testApp({ breaks: { 'dash DELETE /api/env': { status: 500 } } });
    env(t).set('ANTHROPIC_API_KEY', 'sk-ant-api03-existing');
    const r = await t.request('POST', `${BASE}/providers/anthropic/token`, { token: TOKEN, replaceApiKey: true });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('partial_write');
    expect(env(t).get('ANTHROPIC_TOKEN')).toBe(TOKEN);
    const gone = await testApp({ breaks: { 'dash DELETE /api/env': { status: 404, body: { detail: 'not found' } } } });
    gone.fake.config.envValues.set('ANTHROPIC_API_KEY', 'k');
    expect((await gone.request('POST', `${BASE}/providers/anthropic/token`, { token: TOKEN, replaceApiKey: true })).status).toBe(200);
  });

  it('an error that repeats the token does not carry it', async () => {
    const t = await testApp({ breaks: { 'dash PUT /api/env': { status: 400, body: { detail: `bad value ${TOKEN}` } } } });
    const r = await t.request('POST', `${BASE}/providers/anthropic/token`, { token: TOKEN });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).not.toContain(TOKEN);
    expect(JSON.stringify(r.json)).not.toContain('TESTtoken');
  });

  it('removal deletes both token variables, never the API key; 404 when none; a failed delete is reported', async () => {
    const t = await testApp();
    env(t).set('ANTHROPIC_TOKEN', TOKEN);
    env(t).set('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-other-token-zzzzzzzzzz');
    env(t).set('ANTHROPIC_API_KEY', 'sk-ant-api03-keep');
    const r = await t.request('DELETE', `${BASE}/providers/anthropic/token`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ left: [], restartNeeded: true });
    expect(env(t).has('ANTHROPIC_TOKEN')).toBe(false);
    expect(env(t).has('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false);
    expect(env(t).get('ANTHROPIC_API_KEY')).toBe('sk-ant-api03-keep');
    env(t).delete('ANTHROPIC_API_KEY');
    expect((await t.request('DELETE', `${BASE}/providers/anthropic/token`)).status).toBe(404);
    const stuck = await testApp({ breaks: { 'dash DELETE /api/env': { status: 404, body: { detail: 'not in .env' } } } });
    stuck.fake.config.envValues.set('ANTHROPIC_TOKEN', TOKEN);
    const s = await stuck.request('DELETE', `${BASE}/providers/anthropic/token`);
    expect(s.status).toBe(200);
    expect(s.json.left).toEqual(['ANTHROPIC_TOKEN']);
  });

  it('via: login made on the Hermes machine, env list unavailable', async () => {
    const t = await testApp();
    t.fake.config.providers.setAccount('default', 'anthropic', { logged_in: true, source: 'hermes_pkce' });
    expect(await anthropic(t)).toMatchObject({ connected: true, via: 'hermes' });
    const blind = await testApp({ breaks: { 'dash GET /api/env': { status: 500 } } });
    blind.fake.config.envValues.set('ANTHROPIC_TOKEN', TOKEN);
    expect(await anthropic(blind)).toMatchObject({ connected: true, via: null });
  });

  it('the Hermes way to disconnect Anthropic answers 400, passed on', async () => {
    const t = await testApp();
    env(t).set('ANTHROPIC_TOKEN', TOKEN);
    const r = await t.request('DELETE', `${BASE}/providers/anthropic/account`);
    expect(r.status).toBe(400);
  });
});
