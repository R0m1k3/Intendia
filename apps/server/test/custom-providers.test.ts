import { describe, expect, it } from 'vitest';
import { checkEndpoint, keyEnvFor, readCustomProviders, slugFor, withoutProvider } from '../src/hermes-config/custom-providers.js';
import { parse } from '../src/hermes-config/mask.js';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/config';
type T = Awaited<ReturnType<typeof testApp>>;
const providersOf = (t: T) => (parse(t.fake.config.raw).toJS() as any).providers ?? {};
const putConfig = (t: T) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === 'PUT' && r.path === '/api/config');

const SAMPLE = `model:
  default: x
providers:
  ollama-maison:
    name: Ollama maison
    api: http://127.0.0.1:11434/v1
    key_env: INTENDIA_OLLAMA_MAISON_API_KEY
    default_model: llama3.2
  openrouter:
    models: [a]
  proxy:
    base_url: https://proxy.example.test/v1
    api_key: sk-inline
custom_providers:
  - name: Ancien
    base_url: http://old.example.test/v1
    model: m1
# fin
`;

describe('custom endpoints: reading and helpers', () => {
  it('reads the v12 and old shapes, never a key value', () => {
    const r = readCustomProviders(SAMPLE);
    expect(r).toEqual([
      { slug: 'ollama-maison', name: 'Ollama maison', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', key: { kind: 'env', name: 'INTENDIA_OLLAMA_MAISON_API_KEY' }, legacy: false },
      { slug: 'proxy', name: 'proxy', baseUrl: 'https://proxy.example.test/v1', model: null, key: { kind: 'inline' }, legacy: false },
      { slug: null, name: 'Ancien', baseUrl: 'http://old.example.test/v1', model: 'm1', key: null, legacy: true },
    ]);
    expect(JSON.stringify(r)).not.toContain('sk-inline');
  });

  it('slug and key variable', () => {
    expect(slugFor('Ollama maison')).toBe('ollama-maison');
    expect(slugFor(' Éole  v2 ')).toBe('eole-v2');
    expect(slugFor('--')).toBe('');
    expect(keyEnvFor('ollama-maison')).toBe('INTENDIA_OLLAMA_MAISON_API_KEY');
  });

  it('refuses a bad address or a name without letters', () => {
    for (const baseUrl of ['ftp://x.test', 'http://u:p@h.test/v1', 'http://h.test/v1?api_key=s', 'pas une url']) {
      expect(() => checkEndpoint({ name: 'X', baseUrl }), baseUrl).toThrow();
    }
    expect(() => checkEndpoint({ name: '!!', baseUrl: 'http://h.test' })).toThrow();
    expect(checkEndpoint({ name: 'X', baseUrl: 'http://h.test/v1/' }).baseUrl).toBe('http://h.test/v1');
  });

  it('removes one entry and keeps the rest of the file', () => {
    const out = withoutProvider(SAMPLE, 'ollama-maison');
    const doc = parse(out).toJS() as any;
    expect(doc.providers['ollama-maison']).toBeUndefined();
    expect(doc.providers.openrouter.models).toEqual(['a']);
    expect(doc.custom_providers).toHaveLength(1);
    expect(out).toContain('# fin');
  });
});

describe('custom endpoints: HTTP', () => {
  it('adds an endpoint: key in a variable, never in the file; listed with its key set', async () => {
    const t = await testApp();
    const res = await t.request('POST', `${BASE}/custom-providers`, { name: 'Ollama maison', baseUrl: 'http://127.0.0.1:11434/v1/', apiKey: 'sk-ollama-123', model: 'llama3.2' });
    expect(res.status).toBe(201);
    expect(res.json.slug).toBe('ollama-maison');
    expect(providersOf(t)['ollama-maison']).toEqual({
      name: 'Ollama maison', api: 'http://127.0.0.1:11434/v1', key_env: 'INTENDIA_OLLAMA_MAISON_API_KEY', default_model: 'llama3.2', models: ['llama3.2'],
    });
    expect(t.fake.config.raw).not.toContain('sk-ollama-123');
    expect(t.fake.config.envValues.get('INTENDIA_OLLAMA_MAISON_API_KEY')).toBe('sk-ollama-123');
    const list = await t.request('GET', `${BASE}/custom-providers`);
    expect(list.json.writable).toBe(true);
    expect(list.json.endpoints.find((e: any) => e.slug === 'ollama-maison')).toMatchObject({ key: { kind: 'env', name: 'INTENDIA_OLLAMA_MAISON_API_KEY', set: true } });
    expect(JSON.stringify(list.json)).not.toContain('sk-ollama-123');
    // the history keeps a copy, labelled
    expect((await t.request('GET', `${BASE}/versions`)).json.versions[0].source).toBe('custom-providers');
  });

  it('without a key: no variable', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${BASE}/custom-providers`, { name: 'LM Studio', baseUrl: 'http://10.0.0.2:1234/v1' })).status).toBe(201);
    expect(providersOf(t)['lm-studio']).toEqual({ name: 'LM Studio', api: 'http://10.0.0.2:1234/v1' });
    expect([...t.fake.config.envValues.keys()].some((k) => k.startsWith('INTENDIA_'))).toBe(false);
  });

  it('refuses a taken name: existing entry, built-in provider, Hermes alias, old entry, existing variable', async () => {
    const t = await testApp();
    const builtIn = (await t.request('GET', `${BASE}/providers`)).json.keyProviders[0].slug as string;
    t.fake.config.setRaw(`${t.fake.config.raw}\ncustom_providers:\n  - name: Ancien\n    base_url: http://old.test/v1\n`);
    expect((await t.request('POST', `${BASE}/custom-providers`, { name: 'Un', baseUrl: 'http://a.test' })).status).toBe(201);
    t.fake.config.envValues.set('INTENDIA_DEUX_API_KEY', 'x');
    for (const name of ['un', builtIn, 'Ollama', 'ancien']) {
      const r = await t.request('POST', `${BASE}/custom-providers`, { name, baseUrl: 'http://b.test' });
      expect(r.status, name).toBe(409);
      expect(r.json.code).toBe('exists');
    }
    expect((await t.request('POST', `${BASE}/custom-providers`, { name: 'Deux', baseUrl: 'http://b.test', apiKey: 'k' })).json.code).toBe('exists');
    expect((await t.request('POST', `${BASE}/custom-providers`, { name: 'Deux', baseUrl: 'http://b.test' })).status).toBe(201);
    // refusals leave no history copy
    expect((await t.request('GET', `${BASE}/versions`)).json.versions.filter((v: any) => v.source === 'custom-providers')).toHaveLength(2);
  });

  it('config refused after the key was written: the variable goes; uncertain error: it stays', async () => {
    const refused = await testApp({ breaks: { 'dash PUT /api/config': { status: 400 } } });
    expect((await refused.request('POST', `${BASE}/custom-providers`, { name: 'X', baseUrl: 'http://x.test', apiKey: 'k1' })).status).toBe(400);
    expect(refused.fake.config.envValues.has('INTENDIA_X_API_KEY')).toBe(false);
    const uncertain = await testApp({ breaks: { 'dash PUT /api/config': { status: 500 } } });
    const r = await uncertain.request('POST', `${BASE}/custom-providers`, { name: 'X', baseUrl: 'http://x.test', apiKey: 'k1' });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(uncertain.fake.config.envValues.has('INTENDIA_X_API_KEY')).toBe(true);
    // refused, and the variable could not be removed: partial write naming it, history copy kept
    const stuck = await testApp({ breaks: { 'dash PUT /api/config': { status: 400 }, 'dash DELETE /api/env': { status: 500 } } });
    const s = await stuck.request('POST', `${BASE}/custom-providers`, { name: 'X', baseUrl: 'http://x.test', apiKey: 'k1' });
    expect(s.json.code).toBe('partial_write');
    expect(s.json.error ?? s.json.message).toContain('INTENDIA_X_API_KEY');
    expect((await stuck.request('GET', `${BASE}/versions`)).json.versions.some((v: any) => v.source === 'custom-providers')).toBe(true);
  });

  it('masks credentials in existing endpoint addresses', async () => {
    const t = await testApp();
    t.fake.config.setRaw(`${t.fake.config.raw}\ncustom_providers:\n  - base_url: https://user:hunter2@old.test/v1?api_key=sk-q\n`);
    t.fake.config.setRaw(t.fake.config.raw.replace(/^providers:\n/m, 'providers:\n  p:\n    api: https://p.test/v1?token=sk-tok\n'));
    const body = JSON.stringify((await t.request('GET', `${BASE}/custom-providers`)).json);
    for (const s of ['hunter2', 'sk-q', 'sk-tok']) expect(body).not.toContain(s);
    expect(body).toContain('old.test');
  });

  it('removes an endpoint and its INTENDIA_ variable, never another variable', async () => {
    const t = await testApp();
    await t.request('POST', `${BASE}/custom-providers`, { name: 'Ollama maison', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'k', model: 'm' });
    t.fake.config.setRaw(t.fake.config.raw.replace(/^providers:\n/m, 'providers:\n  other:\n    api: http://o.test/v1\n    key_env: CUSTOM_KEY\n'));
    const r = await t.request('DELETE', `${BASE}/custom-providers/ollama-maison`);
    expect(r.status).toBe(200);
    expect(r.json.keyLeft).toBeUndefined();
    expect(providersOf(t)['ollama-maison']).toBeUndefined();
    expect(t.fake.config.envValues.has('INTENDIA_OLLAMA_MAISON_API_KEY')).toBe(false);
    expect((await t.request('DELETE', `${BASE}/custom-providers/other`)).status).toBe(200);
    expect(t.fake.config.envValues.has('CUSTOM_KEY')).toBe(true);
    expect((await t.request('DELETE', `${BASE}/custom-providers/other`)).status).toBe(404);
    expect(putConfig(t)).toHaveLength(1);
  });

  it('refuses to remove the provider of the main model', async () => {
    const t = await testApp();
    await t.request('POST', `${BASE}/custom-providers`, { name: 'Local', baseUrl: 'http://l.test/v1' });
    t.fake.config.setRaw(t.fake.config.raw.replace(/^  provider: auto$/m, '  provider: local'));
    const r = await t.request('DELETE', `${BASE}/custom-providers/local`);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('in_use');
    expect(providersOf(t).local).toBeTruthy();
  });
});
