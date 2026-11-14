import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
// @ts-expect-error plain JS helper shared with the web test
import { listSources, placeholders, scanFiles } from '../../../scripts/i18n-scan.mjs';
import en from '../src/i18n/en.js';
import { makeTranslator, requestLang, toLang, translateJson, translateResponses } from '../src/i18n/index.js';
import { createApp } from '../src/app.js';
import { Auth } from '../src/auth/auth.js';
import { CompatService } from '../src/compat/service.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { InstanceStore } from '../src/instances/store.js';
import { createServices } from '../src/services.js';
import { fakeHttp, fakeInstance, tempDir } from './helpers.js';

type Scan = { file: string; keys: { key: string; line: number }[]; bad: { line: number; text: string }[] };

describe('requestLang', () => {
  const app = new Hono().get('/', (c) => c.text(requestLang(c)));
  const lang = async (headers: Record<string, string>) => (await app.request('/', { headers })).text();
  it('reads the cookie, then Accept-Language, else French', async () => {
    expect(await lang({})).toBe('fr');
    expect(await lang({ Cookie: 'intendia-lang=en' })).toBe('en');
    expect(await lang({ Cookie: 'intendia-lang=fr', 'Accept-Language': 'en-US' })).toBe('fr');
    expect(await lang({ Cookie: 'intendia-lang=de' })).toBe('fr');
    expect(await lang({ Cookie: 'intendia-lang=de', 'Accept-Language': 'de-DE' })).toBe('en');
    expect(await lang({ 'Accept-Language': 'fr-CA,en;q=0.8' })).toBe('fr');
    expect(await lang({ 'Accept-Language': 'fr;q=0, en' })).toBe('en');
  });
});

describe('makeTranslator', () => {
  const tr = makeTranslator({
    'Session vide': 'Empty session',
    'Instance inconnue : {id}': 'Unknown instance: {id}',
    'Hermes n’a pas retenu « {nom} » : mission arrêtée': 'Hermes did not keep “{nom}”: mission stopped',
    '{x} : mission arrêtée': '{x}: mission stopped',
    'Échec (a.b?) : {why}': 'Failed (a.b?): {why}',
    'Champs obligatoires : {fields}': 'Required fields: {fields}',
    'Identifiant': 'Username',
    'Mot de passe': 'Password',
  });
  it('finds exact and variable texts, the longest fixed text first', () => {
    expect(tr('Session vide')).toBe('Empty session');
    expect(tr('Instance inconnue : prod')).toBe('Unknown instance: prod');
    expect(tr('Hermes n’a pas retenu « Écrire » : mission arrêtée')).toBe('Hermes did not keep “Écrire”: mission stopped');
    expect(tr('Échec (a.b?) : Session vide')).toBe('Failed (a.b?): Empty session');
    expect(tr('Champs obligatoires : Identifiant, Mot de passe')).toBe('Required fields: Username, Password');
    expect(tr('Échec (aXb?) : x')).toBeNull();
    expect(tr('connection refused')).toBeNull();
  });
  it('leaves texts unchanged in French', () => {
    expect(toLang('Mot de passe incorrect', 'fr')).toBe('Mot de passe incorrect');
    expect(toLang('Mot de passe incorrect', 'en')).toBe('Wrong password');
  });
  it('never translates names and titles, except the placeholders of Intendia', () => {
    expect(translateJson({ name: 'Mot de passe incorrect', title: 'Session sans titre', items: [{ name: '(sans nom)', title: 'Nouvelle session' }] }, 'en'))
      .toEqual({ name: 'Mot de passe incorrect', title: 'Untitled session', items: [{ name: '(no name)', title: 'New session' }] });
  });
  it('only translates the text fields of a JSON answer', () => {
    expect(translateJson({ error: 'Mot de passe incorrect', label: 'Mot de passe incorrect', reasons: ['Mot de passe incorrect'], errors: [{ message: 'Mot de passe incorrect' }] }, 'en'))
      .toEqual({ error: 'Wrong password', label: 'Mot de passe incorrect', reasons: ['Wrong password'], errors: [{ message: 'Wrong password' }] });
  });
});

describe('output middleware', () => {
  const app = new Hono();
  app.use('*', translateResponses());
  app.get('/err', (c) => c.json({ error: 'Mot de passe incorrect' }, 401));
  app.get('/throw', () => { throw new Error('Mot de passe incorrect'); });
  app.onError((err, c) => c.json({ error: err.message }, 500));
  app.get('/file', (c) => c.body('{"error":"Mot de passe incorrect"}', 200, { 'Content-Type': 'application/json', 'Content-Disposition': 'inline; filename="a.json"', 'Content-Length': '34' }));
  app.get('/bad', (c) => c.body('{not json', 200, { 'Content-Type': 'application/json' }));
  const en_ = { Cookie: 'intendia-lang=en' };
  it('translates JSON answers and onError for English, nothing for French', async () => {
    const r = await app.request('/err', { headers: en_ });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'Wrong password' });
    expect(await (await app.request('/throw', { headers: en_ })).json()).toEqual({ error: 'Wrong password' });
    expect(await (await app.request('/err')).json()).toEqual({ error: 'Mot de passe incorrect' });
  });
  it('leaves raw files and invalid JSON alone', async () => {
    const f = await app.request('/file', { headers: en_ });
    expect(await f.text()).toBe('{"error":"Mot de passe incorrect"}');
    expect(f.headers.get('content-length')).toBe('34');
    const b = await app.request('/bad', { headers: en_ });
    expect(b.status).toBe(200);
    expect(await b.text()).toBe('{not json');
  });
});

describe('completeness of the English dictionary', () => {
  const scans: Scan[] = scanFiles(listSources(join(__dirname, '../src')).filter((f: string) => !f.includes('/src/i18n/')), ['msg']);
  const used = new Map<string, string>();
  for (const s of scans) for (const k of s.keys) if (!used.has(k.key)) used.set(k.key, `${s.file}:${k.line}`);
  const dict = en as Record<string, string>;
  it('only literal keys', () => {
    expect(scans.flatMap((s) => s.bad.map((b) => `${s.file}:${b.line} ${b.text}`))).toEqual([]);
  });
  it('every key has an English text with the same placeholders', () => {
    const problems: string[] = [];
    for (const [k, where] of used) {
      const v = dict[k];
      if (v === undefined) problems.push(`missing: ${JSON.stringify(k)} (${where})`);
      else if (!v.trim()) problems.push(`empty: ${JSON.stringify(k)}`);
      else if (placeholders(k) !== placeholders(v)) problems.push(`placeholders differ: ${JSON.stringify(k)}`);
      if (/^\s*\{\w+\}\s*$/.test(k)) problems.push(`placeholder-only key: ${JSON.stringify(k)} (${where})`);
    }
    expect(problems).toEqual([]);
  });
  it('no unused English text', () => {
    expect(Object.keys(dict).filter((k) => !used.has(k))).toEqual([]);
  });
});

describe('routes in English', () => {
  // the config module loses its schema read: unavailable, with a reason written by the compat engine
  function setup() {
    const dataDir = tempDir();
    const config = loadConfig({ INTENDIA_SECRET: 'x'.repeat(40), INTENDIA_DATA_DIR: dataDir, INTENDIA_TRUST_PROXY: 'true' });
    const db = openDb(dataDir);
    const store = new InstanceStore(db, config);
    const auth = new Auth(db, config);
    const { fetchImpl } = fakeHttp({ breaks: { 'dash GET /api/config/schema': { status: 404 } } });
    const compat = new CompatService(db, store, { moduleStates: async () => {} }, fetchImpl);
    const app = createApp({ config, db, auth, store, compat, fetchImpl, services: createServices({ config, db, store, compat }), version: 'test' });
    let session = '';
    const req = async (method: string, path: string, body?: unknown, lang?: string) => {
      const cookies = [session, lang ? `intendia-lang=${lang}` : ''].filter(Boolean).join('; ');
      const res = await app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Intendia': '1', 'X-Forwarded-For': '10.0.0.2', ...(cookies ? { Cookie: cookies } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) session = set.split(';')[0]!;
      return { status: res.status, json: (await res.json().catch(() => null)) as any };
    };
    return { req, auth, compat };
  }
  const PASSWORD = 'correct horse battery';

  it('answers a wrong password in the language of the browser', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    expect((await t.req('POST', '/x/login', { password: 'nope' }, 'en')).json).toEqual({ error: 'Wrong password' });
    expect((await t.req('POST', '/x/login', { password: 'nope' })).json).toEqual({ error: 'Mot de passe incorrect' });
  });

  it('keeps the compat report French in memory, English only in the answer', async () => {
    const t = setup();
    await t.req('POST', '/x/setup/password', { code: t.auth.setupCode, password: PASSWORD });
    expect((await t.req('POST', '/x/instances', fakeInstance(), 'en')).status).toBe(200);
    const checked = await t.req('POST', '/x/compat/fake/check', {}, 'en');
    const stored = t.compat.get('fake')!.modules.find((m) => m.id === 'config')!;
    expect(stored.state).toBe('unavailable');
    expect(stored.reasons[0]).toMatch(/^Lecture « \w+ » impossible — dashboard GET \/api\/config\/schema : HTTP 404$/);
    const answered = checked.json.modules.find((m: { id: string }) => m.id === 'config');
    expect(answered.reasons[0]).toMatch(/^Cannot read “\w+” — dashboard GET \/api\/config\/schema: HTTP 404$/);
    const fr = (await t.req('GET', '/x/compat')).json.reports[0].modules.find((m: { id: string }) => m.id === 'config');
    expect(fr.reasons[0]).toBe(stored.reasons[0]);
  });
});
