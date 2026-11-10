import { describe, expect, it } from 'vitest';
import { OPENROUTER_MODELS } from 'fake-hermes';
import { forgetChatModels, readChatModels, writeChatModels } from '../src/chat/models-list.js';
import { testApp } from './helpers.js';

const WORK_KEY = 'work-key-00000000000000';
const URL = '/x/i/fake/chat-models';
type T = Awaited<ReturnType<typeof testApp>>;
const optionCalls = (t: T) => t.fake.requests.filter((r) => r.path === '/api/model/options');

describe('chat models, per agent', () => {
  it('never saved → empty list, managed, auto = the main model', async () => {
    const t = await testApp();
    const r = await t.request('GET', URL);
    expect(r.status).toBe(200);
    expect(r.json.models).toEqual([]);
    expect(r.json.managed).toBe(true);
    expect(typeof r.json.auto).toBe('string');
    expect(r.json.auto.length).toBeGreaterThan(0);
  });

  it('saved list keeps its order; a model no longer offered is unavailable; an empty list stays empty', async () => {
    const t = await testApp();
    const put = await t.request('PUT', URL, { models: ['openai/gpt-5.5', 'gone/model', 'anthropic/claude-opus-4.6'] });
    expect(put.status).toBe(200);
    expect(put.json.models).toEqual(['openai/gpt-5.5', 'gone/model', 'anthropic/claude-opus-4.6']);
    const r = await t.request('GET', URL);
    expect(r.json.models).toEqual([
      { id: 'openai/gpt-5.5', available: true },
      { id: 'gone/model', available: false },
      { id: 'anthropic/claude-opus-4.6', available: true },
    ]);
    expect((await t.request('PUT', URL, { models: [] })).status).toBe(200);
    expect((await t.request('GET', URL)).json.models).toEqual([]);
  });

  it('PUT checks the names, duplicates and the limit; names are trimmed', async () => {
    const t = await testApp();
    expect((await t.request('PUT', URL, { models: ['a', 'a'] })).status).toBe(400);
    expect((await t.request('PUT', URL, { models: Array.from({ length: 51 }, (_, i) => `m${i}`) })).status).toBe(400);
    expect((await t.request('PUT', URL, { models: ['bad name'] })).status).toBe(400);
    expect((await t.request('PUT', URL, { models: ['x'.repeat(201)] })).status).toBe(400);
    expect((await t.request('PUT', URL, { models: 'a' })).status).toBe(400);
    expect((await t.request('PUT', URL, { models: Array.from({ length: 50 }, (_, i) => `m${i}`) })).status).toBe(200);
    const r = await t.request('PUT', URL, { models: ['  openai/gpt-5.5 '] });
    expect(r.json.models).toEqual(['openai/gpt-5.5']);
    expect((await t.request('GET', `${URL}/saved`)).json.models).toEqual(['openai/gpt-5.5']);
  });

  it('one list per profile, availability from each profile\'s options', async () => {
    const t = await testApp({ profileKeys: { work: WORK_KEY } });
    await t.request('PUT', URL, { models: ['openai/gpt-5.5'] });
    await t.request('PUT', `${URL}?profile=work`, { models: ['claude-haiku-4.5', 'openai/gpt-5.5'] });
    expect((await t.request('GET', URL)).json.models).toEqual([{ id: 'openai/gpt-5.5', available: true }]);
    expect((await t.request('GET', `${URL}?profile=work`)).json.models).toEqual([
      { id: 'claude-haiku-4.5', available: true },
      { id: 'openai/gpt-5.5', available: false },
    ]);
  });

  it('a profile without a key in Intendia → 400 on every route', async () => {
    const t = await testApp();
    expect((await t.request('GET', `${URL}?profile=ventes`)).status).toBe(400);
    expect((await t.request('GET', `${URL}/saved?profile=ventes`)).status).toBe(400);
    expect((await t.request('PUT', `${URL}?profile=ventes`, { models: [] })).status).toBe(400);
    expect((await t.request('GET', '/x/i/nope/chat-models')).status).toBe(404);
  });

  it('Hermes fails → 200, auto null, the saved list shown as available', async () => {
    const t = await testApp({ breaks: { 'api GET /api/model/options': { status: 500 }, 'dash GET /api/model/options': { status: 500 } } });
    await t.request('PUT', URL, { models: ['gone/model'] });
    const r = await t.request('GET', URL);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ auto: null, models: [{ id: 'gone/model', available: true }], managed: true });
  });

  it('not managed (no Modèles tab) → the whole offered catalogue; an error is passed on', async () => {
    const t = await testApp();
    const unmanage = () => {
      const mod = t.compat.get('fake')!.modules.find((m) => m.id === 'config')!;
      mod.state = 'unavailable';
    };
    unmanage();
    await t.request('PUT', URL, { models: ['gone/model'] });
    const r = await t.request('GET', URL);
    expect(r.json.managed).toBe(false);
    expect(r.json.models.map((m: { id: string }) => m.id)).toEqual([...OPENROUTER_MODELS]);
    const t2 = await testApp({ breaks: { 'api GET /api/model/options': { status: 500 }, 'dash GET /api/model/options': { status: 500 } } });
    t2.compat.get('fake')!.modules.find((m) => m.id === 'config')!.state = 'unavailable';
    expect((await t2.request('GET', URL)).status).toBeGreaterThanOrEqual(400);
  });

  it('the saved list is read without calling Hermes', async () => {
    const t = await testApp();
    const before = optionCalls(t).length;
    await t.request('GET', `${URL}/saved`);
    await t.request('PUT', URL, { models: ['openai/gpt-5.5'] });
    expect(optionCalls(t).length).toBe(before);
  });

  it('removing an instance forgets the lists of its agents only', async () => {
    const t = await testApp();
    writeChatModels(t.db, 'a', 'default', ['x']);
    writeChatModels(t.db, 'a', 'work', ['y']);
    writeChatModels(t.db, 'ab', 'default', ['z']);
    forgetChatModels(t.db, 'a'); // called by DELETE /x/instances/:id (instances are declarative in tests)
    expect(readChatModels(t.db, 'a', 'default')).toEqual([]);
    expect(readChatModels(t.db, 'a', 'work')).toEqual([]);
    expect(readChatModels(t.db, 'ab', 'default')).toEqual(['z']);
  });
});
