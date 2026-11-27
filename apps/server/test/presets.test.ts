
import { describe, expect, it } from 'vitest';
import { settings } from '../src/db/schema.js';
import { presets } from '../src/chat/presets.js';
import { testApp } from './helpers.js';

describe('pinned models and modes', () => {
  it('empty at first, written whole, per instance and profile', async () => {
    const t = await testApp();
    expect((await t.request('GET', '/x/i/fake/model-pins')).json.pins).toEqual([]);
    const pins = [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' }];
    expect((await t.request('PUT', '/x/i/fake/model-pins', { pins })).json.pins).toEqual(pins);
    expect((await t.request('GET', '/x/i/fake/model-pins')).json.pins).toEqual(pins);
    expect((await t.request('GET', '/x/i/fake/model-pins?profile=autre')).json.pins).toEqual([]);
    const modes = [{ id: 'm1', name: 'Rapide', model: 'x', provider: null, effort: 'low' }];
    expect((await t.request('PUT', '/x/i/fake/modes', { modes })).status).toBe(200);
    expect((await t.request('GET', '/x/i/fake/modes')).json.modes).toEqual(modes);
    // a mode saved before the personality was removed: read back without it
    const old = JSON.stringify([{ ...modes[0], personality: 'hermes:brief' }]);
    t.db.insert(settings).values({ key: 'run_modes:fake:default', value: old }).onConflictDoUpdate({ target: settings.key, set: { value: old } }).run();
    expect((await t.request('GET', '/x/i/fake/modes')).json.modes).toEqual(modes);
    expect((await t.request('GET', '/x/i/inconnue/modes')).status).toBe(404);
  });

  it('limits: 21 pins, 31 modes → 400; unreadable JSON in the base → empty list', async () => {
    const t = await testApp();
    const pins = Array.from({ length: 21 }, (_, i) => ({ provider: null, model: `m${i}` }));
    expect((await t.request('PUT', '/x/i/fake/model-pins', { pins })).status).toBe(400);
    const mode = (i: number) => ({ id: `m${i}`, name: `Mode ${i}`, model: null, provider: null, effort: null });
    expect((await t.request('PUT', '/x/i/fake/modes', { modes: Array.from({ length: 31 }, (_, i) => mode(i)) })).status).toBe(400);
    t.db.insert(settings).values({ key: 'model_pins:fake:default', value: '{pas du json' }).onConflictDoUpdate({ target: settings.key, set: { value: '{pas du json' } }).run();
    expect((await t.request('GET', '/x/i/fake/model-pins')).json.pins).toEqual([]);
  });

  it('agent looks: per instance, bounded colour, dropped with the profile', async () => {
    const t = await testApp();
    expect((await t.request('GET', '/x/i/fake/agent-looks')).json.looks).toEqual({});
    expect((await t.request('PUT', '/x/i/fake/agent-looks', { looks: { default: 2, veille: 7 } })).json.looks).toEqual({ default: 2, veille: 7 });
    expect((await t.request('GET', '/x/i/fake/agent-looks')).json.looks).toEqual({ default: 2, veille: 7 });
    expect((await t.request('PUT', '/x/i/fake/agent-looks', { looks: { default: 8 } })).status).toBe(400);
    expect((await t.request('PUT', '/x/i/fake/agent-looks', { looks: { 'a b': 1 } })).status).toBe(400);
    expect((await t.request('GET', '/x/i/inconnue/agent-looks')).status).toBe(404);
    presets.dropProfile(t.db, 'fake', 'veille');
    expect((await t.request('GET', '/x/i/fake/agent-looks')).json.looks).toEqual({ default: 2 });
  });
});
