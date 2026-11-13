import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
import { createFakeHermes, fakeWebSocketFactory } from 'fake-hermes';
import type { WsLike } from '../src/hermes/events.js';
import { probeSocket } from '../src/hermes/gateway-ws.js';
import { VaultService } from '../src/vault/service.js';
import { FIXTURES, fakeInstance, testApp } from './helpers.js';

const V = '/x/i/fake/vault';
const PASSWORD = 'Mot-de-passe-très-secret-42';
const CARD = '4111 1111 1111 1111';
const login = (o: Record<string, unknown> = {}) => ({
  kind: 'login', label: 'GitHub travail', origin: 'https://github.com/login', identifierType: 'email', identifier: 'moi@exemple.fr', password: PASSWORD, ...o,
});
const card = (o: Record<string, unknown> = {}) => ({
  kind: 'payment', label: 'Carte pro', origin: 'https://boutique.exemple.fr', cardNumber: CARD, expMonth: '5', expYear: '30', cvc: '123', ...o,
});
const address = (o: Record<string, unknown> = {}) => ({
  kind: 'address', label: 'Maison', origin: 'https://boutique.exemple.fr', addressLine1: '1 rue des Lilas', city: 'Nancy', postalCode: '54000', country: 'France', ...o,
});

/** Every console call made during the test, as one text (the secret must never be there). */
const logs: string[] = [];
const spy = () => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' ')); });
  }
};
afterEach(() => {
  expect(logs.join('\n')).not.toContain(PASSWORD);
  expect(logs.join('\n')).not.toContain('4111');
  logs.length = 0;
  vi.restoreAllMocks();
});

describe('vault: probe', () => {
  it('present when vault.remove {} gets a JSON-RPC error, absent on -32601 or no answer', async () => {
    const make = (vault: 'on' | 'off') => fakeWebSocketFactory(createFakeHermes({ fixturesDir: FIXTURES, vault }));
    expect((await probeSocket(fakeInstance(), { factory: make('on') })).vault).toBe(true);
    expect((await probeSocket(fakeInstance(), { factory: make('off') })).vault).toBe(false);
    const silent = (): WsLike => ({ addEventListener: () => {}, send: () => {}, close: () => {} });
    expect((await probeSocket(fakeInstance(), { factory: silent, timeoutMs: 30 })).vault).toBe(false);
  });
});

describe('vault: list, add, remove', () => {
  it('adds a login, a card and an address; Hermes gets the secret as typed; the list shows metadata only', async () => {
    spy();
    const t = await testApp();
    expect((await t.request('POST', V, login({ otpSecret: 'JBSWY3DPEHPK3PXP' }))).status).toBe(201);
    expect((await t.request('POST', V, card())).status).toBe(201);
    const add = await t.request('POST', V, address({ addressLine2: '' }));
    expect(add.status).toBe(201);
    expect(add.json.id).toMatch(/^vault_/);

    const stored = t.fake.vault.list('default');
    expect(stored.find((i) => i.kind === 'login')).toMatchObject({ origin: 'https://github.com', identifier: 'moi@exemple.fr', identifier_type: 'email', has_otp: true, secret: { password: PASSWORD, otp_secret: 'JBSWY3DPEHPK3PXP' } });
    expect(stored.find((i) => i.kind === 'payment')!.secret).toEqual({ card_number: '4111111111111111', exp_month: '05', exp_year: '2030', cvc: '123' });
    expect(stored.find((i) => i.kind === 'address')!.secret).toEqual({ address_line1: '1 rue des Lilas', city: 'Nancy', postal_code: '54000', country: 'France' });

    const res = await t.raw('GET', V);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const list = await res.json() as { items: any[]; external: number };
    expect(list.external).toBe(0);
    expect(list.items.map((i) => i.label)).toEqual(['Carte pro', 'GitHub travail', 'Maison']);
    expect(list.items[1]).toEqual({ id: expect.stringMatching(/^vault_/), kind: 'login', label: 'GitHub travail', origin: 'https://github.com', createdAt: expect.any(String), identifier: 'moi@exemple.fr', identifierType: 'email', hasOtp: true });
    expect(list.items[0]).toMatchObject({ identifier: null, identifierType: null, hasOtp: false });
    expect(JSON.stringify(list)).not.toContain(PASSWORD);
    expect(JSON.stringify(list)).not.toContain('4111');
  });

  it('keeps the vault of each profile apart; an unknown profile is 404', async () => {
    const t = await testApp();
    expect((await t.request('POST', '/x/i/fake/agents', { name: 'recherche', cloneFrom: 'default' })).status).toBe(201);
    expect((await t.request('POST', `${V}?profile=recherche`, login())).status).toBe(201);
    expect((await t.request('GET', V)).json.items).toEqual([]);
    expect((await t.request('GET', `${V}?profile=recherche`)).json.items).toHaveLength(1);
    expect(await t.request('GET', `${V}?profile=inconnu`)).toMatchObject({ status: 404, json: { error: 'Profil inconnu' } });
  });

  it('lists only the local vault and counts the items of an external manager', async () => {
    const t = await testApp({ vault: 'external' });
    await t.request('POST', V, login());
    const list = (await t.request('GET', V)).json;
    expect(list.items).toHaveLength(1);
    expect(list.external).toBe(1);
  });

  it('a vault list blocked by an external manager gives a fixed message, without the text of Hermes', async () => {
    const t = await testApp({ vault: 'list_fail' });
    const res = await t.request('GET', V);
    expect(res.status).toBe(502);
    expect(res.json.error).toBe("Hermes n'a pas pu lire le coffre (un gestionnaire de mots de passe externe peut le bloquer)");
    expect(JSON.stringify(res.json)).not.toContain('1Password CLI');
    // adding does not read the list
    expect((await t.request('POST', V, login())).status).toBe(201);
  });

  it('removes an item; an unknown one is 404; a malformed id is 400', async () => {
    const t = await testApp();
    const { id } = (await t.request('POST', V, login())).json;
    expect((await t.raw('DELETE', `${V}/${id}`)).status).toBe(204);
    expect(t.fake.vault.list()).toEqual([]);
    expect((await t.request('DELETE', `${V}/${id}`)).status).toBe(404);
    expect(await t.request('DELETE', `${V}/abc`)).toMatchObject({ status: 400, json: { code: 'invalid_field', field: 'id' } });
  });
});

describe('vault: validation', () => {
  it.each([
    ['label', login({ label: ' ' }), 'Champ obligatoire'],
    ['origin', login({ origin: undefined }), 'Champ obligatoire'],
    ['origin', login({ origin: 'javascript:alert(1)' }), 'Adresse du site invalide (http:// ou https://)'],
    ['identifier', login({ identifier: '' }), 'Champ obligatoire'],
    ['identifierType', login({ identifierType: 'pseudo' }), 'Valeur non prise en charge'],
    ['password', login({ password: '' }), 'Champ obligatoire'],
    ['origin', card({ origin: '' }), 'Champ obligatoire'],
    ['cardNumber', card({ cardNumber: '1234' }), 'Numéro de carte invalide'],
    ['expMonth', card({ expMonth: '13' }), 'Mois entre 1 et 12'],
    ['expYear', card({ expYear: '203' }), 'Année sur 2 ou 4 chiffres'],
    ['cvc', card({ cvc: undefined }), 'Champ obligatoire'],
    ['cvc', card({ cvc: '12a' }), '3 ou 4 chiffres'],
    ['addressLine1', address({ addressLine1: '' }), 'Champ obligatoire'],
    ['country', address({ country: undefined }), 'Champ obligatoire'],
    ['label', login({ label: 'x'.repeat(121) }), 'Trop long (120 caractères au plus)'],
  ])('%s refused: %s', async (field, body, error) => {
    spy();
    const t = await testApp();
    const res = await t.request('POST', V, body);
    expect(res).toMatchObject({ status: 400, json: { code: 'invalid_field', field, error } });
    expect(JSON.stringify(res.json)).not.toContain(PASSWORD);
    expect(t.fake.vault.list()).toEqual([]);
  });

  it('refuses an unknown key, an unknown kind, a malformed body and a too big body, quoting nothing', async () => {
    spy();
    const t = await testApp();
    expect(await t.request('POST', V, login({ note: PASSWORD }))).toMatchObject({ status: 400, json: { field: 'note', error: 'Champ inconnu' } });
    expect((await t.request('POST', V, login({ kind: 'note' }))).status).toBe(400);
    const bad = await t.rawRequest('POST', V, { body: `{"kind":"login","password":"${PASSWORD}"`, headers: { 'Content-Type': 'application/json' } });
    expect(bad.status).toBe(400);
    const text = await bad.text();
    expect(text).toContain('Corps illisible');
    expect(text).not.toContain(PASSWORD);
    const big = await t.rawRequest('POST', V, { body: JSON.stringify(login({ password: 'x'.repeat(20_000) })), headers: { 'Content-Type': 'application/json' } });
    expect(big.status).toBe(413);
  });

  it('needs a signed-in user', async () => {
    const t = await testApp();
    const res = await t.rawRequest('GET', V, { cookie: false });
    expect(res.status).toBe(401);
  });
});

describe('vault: errors of Hermes', () => {
  it('translates the missing fields of a refusal; an unknown refusal gives a fixed message', async () => {
    spy();
    const t = await testApp();
    const svc = new VaultService(t.compat, t.store);
    // the fake refuses like Hermes when a required field is missing (here past the checks of Intendia)
    const missing = await svc.add('fake', 'default', { ...card(), cardNumber: '4111111111111111', expMonth: '05', expYear: '2030', cvc: '' } as never).catch((e: unknown) => e as any);
    expect(missing).toMatchObject({ code: 'invalid_field', message: 'Champs obligatoires : Cryptogramme', extra: { field: 'cvc' } });
    const loginMissing = await svc.add('fake', 'default', { ...login(), identifier: '' } as never).catch((e: unknown) => e as any);
    expect(loginMissing).toMatchObject({ message: 'Champs obligatoires : Identifiant, Mot de passe', extra: { field: 'identifier' } });
    const other = await svc.add('fake', 'default', { ...login(), identifierType: PASSWORD } as never).catch((e: unknown) => e as any);
    expect(other).toMatchObject({ code: 'invalid_field', message: "Hermes a refusé l'enregistrement" });
    expect(JSON.stringify(other)).not.toContain(PASSWORD);
  });

  it('a Hermes without the vault is 409; no answer is 504', async () => {
    const off = await testApp({ vault: 'off' });
    expect(off.compat.get('fake')?.socket?.vault).toBe(false);
    expect(await off.request('GET', V)).toMatchObject({ status: 409, json: { code: 'unsupported' } });
    expect((await off.request('POST', V, login())).status).toBe(409);

    const t = await testApp();
    const silent = (): WsLike => ({ addEventListener: () => {}, send: () => {}, close: () => {} });
    const compat = Object.assign(Object.create(Object.getPrototypeOf(t.compat)), t.compat, { wsFactory: silent });
    const svc = new VaultService(compat, t.store, { timeoutMs: 30 });
    await expect(svc.list('fake', 'default')).rejects.toMatchObject({ kind: 'timeout', message: 'Hermes ne répond pas' });
  });
});

describe('vault: replace', () => {
  it('adds the new item, then removes the old one', async () => {
    spy();
    const t = await testApp();
    const { id } = (await t.request('POST', V, login())).json;
    const res = await t.request('POST', `${V}/${id}/replace`, login({ password: 'Nouveau-mot-de-passe-1' }));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ id: expect.stringMatching(/^vault_/), oldKept: false });
    expect(res.json.id).not.toBe(id);
    expect(t.fake.vault.list().map((i) => i.secret.password)).toEqual(['Nouveau-mot-de-passe-1']);
  });

  it('a refused new item leaves the old one as it was', async () => {
    const t = await testApp();
    const { id } = (await t.request('POST', V, login())).json;
    expect((await t.request('POST', `${V}/${id}/replace`, login({ password: '' }))).status).toBe(400);
    expect(t.fake.vault.list().map((i) => i.id)).toEqual([id]);
  });

  it('says when the old item could not be removed; an old item already gone is not kept', async () => {
    const t = await testApp({ vault: 'remove_fail' });
    const { id } = (await t.request('POST', V, login())).json;
    const kept = await t.request('POST', `${V}/${id}/replace`, login({ password: 'Autre-1' }));
    expect(kept.json.oldKept).toBe(true);
    expect(t.fake.vault.list()).toHaveLength(2);
    const gone = await t.request('POST', `${V}/vault_ffffffffffff/replace`, login({ password: 'Autre-2' }));
    expect(gone.json.oldKept).toBe(false);
  });
});
