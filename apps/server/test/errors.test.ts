import { afterEach, describe, expect, it, vi } from 'vitest';
import { hermesErrorResponse } from '../src/connectors/errors.js';
import { HermesError } from '../src/hermes/http.js';
import { testApp } from './helpers.js';

const KANBAN = '/x/i/fake/kanban/board?board=default';
// sessions.list: API server only
const API_OP = '/x/i/fake/other-sessions';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Hermes errors sent to the web', () => {
  it('a refused dashboard token: 502 dash_token_refused before the check, 409 with the action after', async () => {
    const breaks = {};
    const t = await testApp({ breaks });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    t.fake.auth.dashToken = 'autre';
    const before = await t.request('GET', KANBAN);
    expect(before.status).toBe(502);
    expect(before.json.code).toBe('dash_token_refused');
    expect(before.json.hermesStatus).toBe(401);
    expect(before.json.error).toContain('Réglages › Instances › Modifier');
    await t.compat.check('fake');
    const after = await t.request('GET', KANBAN);
    expect(after.status).toBe(409);
    expect(after.json.code).toBe('dash_token_refused');
    expect(after.json.error).toContain('mettez-le à jour dans Réglages › Instances › Modifier');
    t.compat.stop();
  });

  it('API server down: 504 hermes_unreachable, at once after the check', async () => {
    const t = await testApp();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    t.fake.down.add('api');
    // before the check: the raw network error
    const raw = await t.request('GET', API_OP);
    expect(raw.status).toBe(504);
    expect(raw.json.code).toBe('hermes_unreachable');
    // the network error asked for a check, which sees the outage
    await t.compat.check('fake');
    expect(t.compat.get('fake')!.outage?.api).toBe(true);
    const n = t.fake.requests.length;
    const fast = await t.request('GET', API_OP);
    expect(fast.status).toBe(504);
    expect(fast.json.code).toBe('hermes_unreachable');
    expect(fast.json.error).toBe('Hermes ne répond pas : réessayez dans un instant');
    expect(t.fake.requests.length).toBe(n);
    t.compat.stop();
  });

  it('429: 503 with Retry-After and hermes_busy', async () => {
    const breaks: Record<string, { status?: number; body?: unknown }> = {};
    const t = await testApp({ breaks });
    breaks['api GET /api/sessions'] = { status: 429, body: { error: 'too many runs' } };
    const res = await t.raw('GET', API_OP);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'hermes_busy', hermesStatus: 429, error: 'Hermes est occupé : réessayez dans 5 s' });
  });

  it('409: hermes_conflict with the detail of Hermes', async () => {
    const breaks: Record<string, { status?: number; body?: unknown }> = {};
    const t = await testApp({ breaks });
    breaks['api GET /api/sessions'] = { status: 409, body: { detail: 'session verrouillée' } };
    const res = await t.request('GET', API_OP);
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: 'hermes_conflict', hermesStatus: 409, hermesDetail: 'session verrouillée', error: 'Hermes refuse pour l’instant : session verrouillée' });
  });

  it('another status: 502 hermes_error, secrets of the detail masked', async () => {
    const breaks: Record<string, { status?: number; body?: unknown }> = {};
    const t = await testApp({ breaks });
    breaks['api GET /api/sessions'] = { status: 500, body: { detail: 'boom sk-abcdefghijklmnopqrstuvwxyz123456 token=abc12345 fake-dashboard-token' } };
    const res = await t.request('GET', API_OP);
    expect(res.status).toBe(502);
    expect(res.json.code).toBe('hermes_error');
    const text = JSON.stringify(res.json);
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(text).not.toContain('abc12345');
    expect(text).not.toContain('fake-dashboard-token');
    expect(res.json.hermesDetail).toContain('«secret:');
    expect(res.json.error).toContain('Erreur d’Hermes (HTTP 500) : boom «secret:');
  });

  it('English with the intendia-lang cookie', async () => {
    const breaks: Record<string, { status?: number; body?: unknown }> = {};
    const t = await testApp({ breaks });
    breaks['api GET /api/sessions'] = { status: 429 };
    const res = await t.raw('GET', API_OP, undefined, { Cookie: `${t.cookie()}; intendia-lang=en` });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('Hermes is busy: try again in 5 s');
  });

  it('never 401, for every kind', () => {
    const mask = (s: string) => s;
    const kinds = [
      new HermesError('http', 'x', { via: 'dash', status: 401 }, true),
      new HermesError('http', 'x', { via: 'api', status: 401 }, true),
      new HermesError('http', 'x', { via: 'api', status: 403 }, true),
      new HermesError('network', 'x', { via: 'api' }, true),
      new HermesError('timeout', 'x', { via: 'dash' }, true),
      new HermesError('schema', 'x', {}, true),
      new HermesError('unconfigured', 'x', {}, true),
      new HermesError('http', 'message du service', { status: 401, via: 'dash' }),
    ];
    const out = kinds.map((e) => hermesErrorResponse(e, mask));
    for (const r of out) expect(r.status).not.toBe(401);
    expect(out.map((r) => r.body.code)).toEqual([
      'dash_token_refused', 'api_key_refused', 'hermes_error', 'hermes_unreachable', 'hermes_timeout', 'hermes_schema', 'hermes_unconfigured', 'dash_token_refused',
    ]);
    // a service's own message is kept, except for the codes that say what to do
    expect(hermesErrorResponse(new HermesError('http', 'message du service', { status: 500 }), mask).body.error).toBe('message du service');
    expect(out[7]!.body.error).toContain('Modifier');
  });
});

