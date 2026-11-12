import { describe, expect, it } from 'vitest';
import { cleanTitle } from '../src/sessions/title-ai.js';
import { testApp, waitRun } from './helpers.js';

async function setup(oneshot: 'ok' | 'off' | 'no_model' = 'ok') {
  const t = await testApp({ oneshot });
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  const base = `/x/sessions/fake/${s.id}`;
  return { t, s, base };
}

describe('title by AI', () => {
  it('cleans the answer: first line, quotes, final dot, length', () => {
    expect(cleanTitle('« Ventes de Noël. »\nAutre')).toBe('Ventes de Noël');
    expect(cleanTitle('Titre : "Inventaire Frouard"')).toBe('Inventaire Frouard');
    expect(cleanTitle('x'.repeat(80))).toHaveLength(60);
    expect(cleanTitle('\n  \n')).toBe('');
  });

  it('asks the auxiliary model and saves the title at Intendia and Hermes', async () => {
    const { t, s, base } = await setup();
    const r = await t.request('POST', `${base}/runs`, { input: 'Prépare la promo de Noël à Frouard' });
    await waitRun(t, base, r.json.runId);
    expect(t.compat.get('fake')?.socket?.oneshot).toBe(true);
    const res = await t.request('POST', `${base}/title/generate`);
    expect(res.status).toBe(200);
    expect(res.json.session.title).toBe('Prépare la promo de Noël');
    const title = await t.fake.api.request(`/_fake/sessions/${s.id}/title`);
    expect((await title.json()).title).toBe('Prépare la promo de Noël');
  });

  it('no model for titles → 503 no_model; method absent → 409 unsupported; empty session → 404', async () => {
    const none = await setup('no_model');
    const r = await none.t.request('POST', `${none.base}/runs`, { input: 'Bonjour' });
    await waitRun(none.t, none.base, r.json.runId);
    const res = await none.t.request('POST', `${none.base}/title/generate`);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe('no_model');
    const off = await setup('off');
    expect(off.t.compat.get('fake')?.socket?.oneshot).toBe(false);
    const absent = await off.t.request('POST', `${off.base}/title/generate`);
    expect(absent.status).toBe(409);
    expect(absent.json.code).toBe('unsupported');
    const empty = await setup();
    expect((await empty.t.request('POST', `${empty.base}/title/generate`)).status).toBe(404);
  });

  it('one generation at a time per session', async () => {
    const { t, base } = await setup();
    const r = await t.request('POST', `${base}/runs`, { input: 'Bonjour' });
    await waitRun(t, base, r.json.runId);
    const [a, b] = await Promise.all([t.request('POST', `${base}/title/generate`), t.request('POST', `${base}/title/generate`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
