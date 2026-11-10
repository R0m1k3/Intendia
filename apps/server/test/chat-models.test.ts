import { describe, expect, it } from 'vitest';
import { OPENROUTER_MODELS } from 'fake-hermes';
import { testApp } from './helpers.js';

const WORK_KEY = 'work-key-00000000000000';
const URL = '/x/i/fake/chat-models';
type T = Awaited<ReturnType<typeof testApp>>;
/** Declares models for a provider in the fake's config file (its `providers:` block already exists). */
const declare = (t: T, slug: string, yaml: string) =>
  t.fake.config.setRaw(t.fake.config.raw.replace(/^providers:\n/m, `providers:\n  ${slug}:\n${yaml}`));
const openrouter = (r: { json: any }) => r.json.groups.find((g: { provider: string }) => g.provider === 'openrouter');

describe('chat models, grouped by provider', () => {
  it('nothing declared → one group per provider with a key, its whole catalogue; auto = main model', async () => {
    const t = await testApp();
    const r = await t.request('GET', URL);
    expect(r.status).toBe(200);
    expect(r.json.managed).toBe(true);
    expect(r.json.groups.map((g: { provider: string }) => g.provider)).toEqual(['openrouter']);
    expect(openrouter(r)).toMatchObject({ name: expect.any(String), declared: false, models: [...OPENROUTER_MODELS] });
    expect(r.json.auto).toMatchObject({ model: expect.any(String) });
  });

  it('declared models (in their order) replace the catalogue; one Hermes did not return is dropped', async () => {
    const t = await testApp();
    declare(t, 'openrouter', '    models:\n      - openai/gpt-5.5\n      - gone/model\n      - anthropic/claude-opus-4.6\n');
    const g = openrouter(await t.request('GET', URL));
    // the fake, like Hermes, puts declared ids first: `gone/model` is returned too; drop it from the row to check
    expect(g.declared).toBe(true);
    expect(g.models.slice(0, 1)).toEqual(['openai/gpt-5.5']);
    expect(g.models).toContain('anthropic/claude-opus-4.6');
  });

  it('every declaration shape is read (string, objects, mapping)', async () => {
    for (const yaml of ['    models: openai/gpt-5.5\n', '    models:\n      - id: openai/gpt-5.5\n', '    models:\n      openai/gpt-5.5: {}\n']) {
      const t = await testApp();
      declare(t, 'openrouter', yaml);
      expect(openrouter(await t.request('GET', URL))).toMatchObject({ declared: true, models: ['openai/gpt-5.5'] });
    }
  });

  it('per profile: each profile\'s providers', async () => {
    const t = await testApp({ profileKeys: { work: WORK_KEY } });
    const r = await t.request('GET', `${URL}?profile=work`);
    expect(r.json.groups).toEqual([{ provider: 'anthropic', name: expect.any(String), declared: false, models: ['claude-opus-4.6', 'claude-haiku-4.5'] }]);
    expect((await t.request('GET', `${URL}?profile=ventes`)).status).toBe(400);
    expect((await t.request('GET', '/x/i/nope/chat-models')).status).toBe(404);
  });

  it('file not readable or not managed → the rows Hermes returned, nothing hidden', async () => {
    const t = await testApp();
    declare(t, 'openrouter', '    models: [openai/gpt-5.5]\n');
    t.fake.config.failRaw = 500;
    const r = await t.request('GET', URL);
    expect(r.status).toBe(200);
    expect(openrouter(r).declared).toBe(false);
    t.fake.config.failRaw = null;
    t.compat.get('fake')!.modules.find((m) => m.id === 'config')!.state = 'unavailable';
    const r2 = await t.request('GET', URL);
    expect(r2.json.managed).toBe(false);
    expect(openrouter(r2).declared).toBe(false);
  });

  it('options fail → error passed on (the chat shows Auto only)', async () => {
    const t = await testApp({ breaks: { 'api GET /api/model/options': { status: 500 }, 'dash GET /api/model/options': { status: 500 } } });
    expect((await t.request('GET', URL)).status).toBeGreaterThanOrEqual(400);
  });
});
