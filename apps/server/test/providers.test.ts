import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OAuthProvidersSchema, PoolSchema } from '../src/connectors/config/index.js';
import { configVersions } from '../src/db/schema.js';
import { decrypt } from '../src/crypto.js';
import { FIXTURES, testApp } from './helpers.js';

const BASE = '/x/i/fake/config';
const CHAT = '/x/i/fake/chat-models';
type T = Awaited<ReturnType<typeof testApp>>;

const groups = async (t: T) => ((await t.request('GET', CHAT)).json.groups as { provider: string }[]).map((g) => g.provider);
const providers = async (t: T, profile = 'default') => {
  const res = await t.request('GET', `${BASE}/providers?profile=${profile}`);
  expect(res.status).toBe(200);
  return res.json;
};
const lastLoginCopy = (t: T) => {
  const rows = t.db.select().from(configVersions).all().filter((r) => JSON.parse(r.configJson).source === 'provider-login');
  return rows.at(-1);
};

describe('provider accounts and API keys', () => {
  it('lists accounts and API keys without any part of a token or a server path', async () => {
    const t = await testApp();
    t.fake.config.providers.seedSamples();
    const info = await providers(t);
    expect(info.accounts.map((a: { id: string }) => a.id)).toEqual(['nous', 'openai-codex', 'xai-oauth', 'minimax-oauth', 'anthropic', 'claude-code']);
    expect(info.accounts.find((a: { id: string }) => a.id === 'openai-codex').connected).toBe(true);
    expect(info.accounts.find((a: { id: string }) => a.id === 'anthropic')).toMatchObject({ flow: 'external', cliCommand: 'hermes auth add anthropic' });
    // the OAuth entry of the pool is not an API key
    expect(info.keys).toEqual([{ provider: 'mistral', id: 'env001', label: 'MISTRAL_API_KEY', source: 'env:MISTRAL_API_KEY', lastStatus: 'ok' }]);
    const slugs = info.keyProviders.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('deepseek');
    expect(slugs.some((s: string) => s.startsWith('custom:'))).toBe(false);
    const text = JSON.stringify(info);
    expect(text).not.toMatch(/token_preview|access_token|source_label|\/opt\/data|sk-t/);
  });

  it('never sends back a key it added', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${BASE}/provider-keys`, { provider: 'deepseek', apiKey: 'sk-test-0123456789' })).status).toBe(200);
    const text = JSON.stringify(await providers(t));
    expect(text).not.toContain('sk-test-0123456789');
    expect(text).not.toContain('sk-t');
    expect(text).not.toContain('6789');
  });

  it('connects a subscription by device code; the chat offers it and the config copy keeps the file before', async () => {
    const t = await testApp();
    expect(await groups(t)).not.toContain('nous');
    const start = await t.request('POST', `${BASE}/providers/nous/connect`);
    expect(start.status).toBe(200);
    expect(start.json).toMatchObject({ userCode: 'FAKE-1234', verificationUrl: 'https://example.test/device', pollInterval: 2, expiresIn: 900 });
    const sid = start.json.sessionId as string;
    expect((await t.request('GET', `${BASE}/providers/nous/connect/${sid}`)).json).toEqual({ status: 'pending', error: null, model: null });
    expect((await t.request('GET', `${BASE}/providers/nous/connect/${sid}`)).json).toEqual({ status: 'approved', error: null, model: 'nous/hermes-4' });
    expect(await groups(t)).toContain('nous');
    expect((await providers(t)).accounts.find((a: { id: string }) => a.id === 'nous').connected).toBe(true);
    // the copy taken before the login has the old main model; the file now has the one Hermes chose
    const copy = lastLoginCopy(t);
    expect(copy).toBeDefined();
    const before = decrypt(t.config.secret, JSON.parse(copy!.configJson).enc, 'config-history-v1');
    expect(before).not.toContain('nous/hermes-4');
    expect(t.fake.config.raw).toContain('nous/hermes-4');
  });

  it('reports refusals, unknown sessions and external providers', async () => {
    const t = await testApp();
    const x = await t.request('POST', `${BASE}/providers/xai-oauth/connect`);
    const polled = (await t.request('GET', `${BASE}/providers/xai-oauth/connect/${x.json.sessionId}`)).json;
    expect(polled.status).toBe('denied');
    expect(polled.error).toMatch(/refused/);
    expect((await t.request('GET', `${BASE}/providers/nous/connect/nope`)).json.status).toBe('expired');
    const ext = await t.request('POST', `${BASE}/providers/anthropic/connect`);
    expect(ext.status).toBe(400);
    expect(ext.json.error).toMatch(/hermes auth add anthropic/);
    // the copy taken for a login Hermes refused is dropped
    expect(t.db.select().from(configVersions).all().filter((r) => JSON.parse(r.configJson).source === 'provider-login')).toHaveLength(1);
  });

  it('cancels a login: the session is gone', async () => {
    const t = await testApp();
    const sid = (await t.request('POST', `${BASE}/providers/nous/connect`)).json.sessionId as string;
    expect((await t.request('DELETE', `${BASE}/connect/${sid}`)).json).toEqual({ ok: true });
    expect((await t.request('GET', `${BASE}/providers/nous/connect/${sid}`)).json.status).toBe('expired');
    expect((await t.request('DELETE', `${BASE}/connect/unknown`)).json).toEqual({ ok: true });
    expect((await providers(t)).accounts.find((a: { id: string }) => a.id === 'nous').connected).toBe(false);
  });

  it('disconnects an account, and relays a refusal', async () => {
    const t = await testApp();
    t.fake.config.providers.seedSamples();
    expect(await groups(t)).toContain('openai-codex');
    expect((await t.request('DELETE', `${BASE}/providers/openai-codex/account`)).json).toEqual({ ok: true });
    expect(await groups(t)).not.toContain('openai-codex');
    t.fake.config.providers.setAccount('default', 'nous', { disconnectable: false, logged_in: true });
    const res = await t.request('DELETE', `${BASE}/providers/nous/account`);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('hermes_refused');
  });

  it('adds and removes an API key; the chat follows', async () => {
    const t = await testApp();
    expect(await groups(t)).not.toContain('deepseek');
    const add = await t.request('POST', `${BASE}/provider-keys`, { provider: 'deepseek', apiKey: 'sk-test-deep-1111', label: 'Perso' });
    expect(add.json).toEqual({ count: 1 });
    expect(await groups(t)).toContain('deepseek');
    const key = (await providers(t)).keys.find((k: { provider: string }) => k.provider === 'deepseek');
    expect(key).toMatchObject({ label: 'Perso', source: 'manual' });
    expect((await t.request('DELETE', `${BASE}/provider-keys/deepseek/${key.id}`)).json).toEqual({ ok: true });
    expect(await groups(t)).not.toContain('deepseek');
    expect((await providers(t)).keys).toEqual([]);
    expect((await t.request('DELETE', `${BASE}/provider-keys/deepseek/${key.id}`)).status).toBe(404);
  });

  it('removes the right key when several are listed', async () => {
    const t = await testApp();
    await t.request('POST', `${BASE}/provider-keys`, { provider: 'deepseek', apiKey: 'sk-test-a-1111', label: 'A' });
    await t.request('POST', `${BASE}/provider-keys`, { provider: 'deepseek', apiKey: 'sk-test-b-2222', label: 'B' });
    const b = (await providers(t)).keys.find((k: { label: string }) => k.label === 'B');
    await t.request('DELETE', `${BASE}/provider-keys/deepseek/${b.id}`);
    expect(t.fake.config.providers.poolOf('default').map((e) => e.access_token)).toEqual(['sk-test-a-1111']);
  });

  it('refuses to remove a key that comes from a variable', async () => {
    const t = await testApp();
    t.fake.config.providers.seedSamples();
    const res = await t.request('DELETE', `${BASE}/provider-keys/mistral/env001`);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('not_manual');
    expect(t.fake.config.providers.poolOf('default').some((e) => e.id === 'env001')).toBe(true);
  });

  it('removes the sent key from a Hermes error', async () => {
    const t = await testApp();
    const res = await t.request('POST', `${BASE}/provider-keys`, { provider: 'deepseek', apiKey: 'refuse-sk-zzz' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).not.toContain('refuse-sk-zzz');
    expect(res.json.error).toContain('•••');
  });

  it('keeps each profile apart', async () => {
    const t = await testApp();
    await t.request('POST', `${BASE}/provider-keys?profile=coder`, { provider: 'deepseek', apiKey: 'sk-test-coder-1' });
    expect((await providers(t, 'coder')).keys).toHaveLength(1);
    expect((await providers(t, 'default')).keys).toEqual([]);
  });

  it('shows a part as unavailable when Hermes lacks its route', async () => {
    const t = await testApp({ hide: { openapi: ['GET /api/providers/oauth'] } });
    const info = await providers(t);
    expect(info.accounts).toBeNull();
    expect(info.keys).toEqual([]);
  });

  it('validates its input', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${BASE}/providers/a%20b/connect`)).status).toBe(400);
    expect((await t.request('POST', `${BASE}/provider-keys`, { provider: 'deepseek', apiKey: '  ' })).status).toBe(400);
    expect((await t.request('POST', `${BASE}/provider-keys`, { provider: 'deep seek', apiKey: 'x' })).status).toBe(400);
  });

  it('reads the recorded Hermes answers with its schemas', () => {
    const read = (f: string) => (JSON.parse(readFileSync(join(FIXTURES, 'dash', f), 'utf8')) as { body: unknown }).body;
    expect(OAuthProvidersSchema.safeParse(read('GET_api_providers_oauth.json')).success).toBe(true);
    expect(PoolSchema.safeParse(read('GET_api_credentials_pool.json')).success).toBe(true);
  });
});
