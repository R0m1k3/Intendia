import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/agents';
type T = Awaited<ReturnType<typeof testApp>>;
const dash = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);

/** An assigned task dispatched on the default board: one active worker for `profile`. */
async function worker(t: T, profile: string, title = 'Rapport stuck') {
  const created = await t.fake.dash.request('/api/plugins/kanban/tasks?board=default', {
    method: 'POST', headers: { Authorization: 'Bearer fake-dashboard-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, assignee: profile }),
  });
  const { task } = (await created.json()) as { task: { id: string } };
  await t.fake.dash.request('/api/plugins/kanban/dispatch?board=default', { method: 'POST', headers: { Authorization: 'Bearer fake-dashboard-token' } });
  return task.id;
}

describe('agents', () => {
  it('lists the profiles with the chat key state and the active workers', async () => {
    const t = await testApp({ profileKeys: { recherche: 'recherche-key-0000000000' } });
    await t.request('POST', BASE, { name: 'recherche' });
    await t.request('POST', BASE, { name: 'redaction' });
    await worker(t, 'recherche');
    const res = await t.request('GET', BASE);
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.json.agents.map((a: any) => [a.name, a]));
    expect(by.default).toMatchObject({ isDefault: true, hasKey: true, workers: 0, model: 'anthropic/claude-opus-4.6', skillCount: 44 });
    expect(by.recherche).toMatchObject({ hasKey: true, workers: 1 });
    expect(by.redaction).toMatchObject({ hasKey: false, workers: 0 });
    // the kanban is shared by every profile: no ?profile= on its routes
    expect(t.fake.requests.filter((r) => r.path.startsWith('/api/plugins/kanban/')).every((r) => !('profile' in r.query))).toBe(true);
  });

  it('hides the workers when the kanban module is unavailable', async () => {
    const t = await testApp({ breaks: { 'dash GET /api/plugins/kanban/board': { status: 404 } } });
    const res = await t.request('GET', BASE);
    expect(res.json.agents[0].workers).toBeNull();
  });

  it('creates a profile with name, description and clone source only', async () => {
    const t = await testApp();
    const res = await t.request('POST', BASE, { name: 'veille', description: 'Suit la presse', cloneFrom: 'default' });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ name: 'veille', keySource: 'env', modelError: null });
    expect(dash(t, 'POST', '/api/profiles').at(-1)?.body).toEqual({ name: 'veille', description: 'Suit la presse', clone_from: 'default' });
    expect((await t.request('GET', BASE)).json.agents.map((a: any) => a.name)).toContain('veille');
  });

  it('refuses an existing name (409) and relays Hermes refusals (400)', async () => {
    const t = await testApp();
    const dup = await t.request('POST', BASE, { name: 'default' });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe('agent_exists');
    const reserved = await t.request('POST', BASE, { name: 'root' });
    expect(reserved.status).toBe(400);
    expect(reserved.json.error).toContain('reserved');
    const bad = await t.request('POST', BASE, { name: 'Mauvais Nom' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('Invalid profile name');
    expect(dash(t, 'POST', '/api/profiles')).toHaveLength(2);
  });

  it('refuses a description over 1000 characters without calling Hermes', async () => {
    const t = await testApp();
    const res = await t.request('PUT', `${BASE}/default/description`, { description: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(dash(t, 'PUT', '/api/profiles/default/description')).toHaveLength(0);
  });

  it('sets the description, through the kanban route when the profiles one is gone', async () => {
    const t = await testApp();
    expect((await t.request('PUT', `${BASE}/default/description`, { description: 'Agent principal' })).status).toBe(200);
    expect(dash(t, 'PUT', '/api/profiles/default/description')).toHaveLength(1);
    expect((await t.request('GET', `${BASE}/default/detail`)).json.agent.description).toBe('Agent principal');

    const t2 = await testApp({ hide: { openapi: ['PUT /api/profiles/{name}/description'] } });
    expect((await t2.request('PUT', `${BASE}/default/description`, { description: 'Par le kanban' })).status).toBe(200);
    expect(dash(t2, 'PATCH', '/api/plugins/kanban/profiles/default')).toHaveLength(1);
    // never the rename route
    expect(t2.fake.requests.some((r) => r.method === 'PATCH' && r.path === '/api/profiles/default')).toBe(false);
  });

  it('shows SOUL.md with token-like secrets masked', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${BASE}/default/detail`);
    expect(res.status).toBe(200);
    expect(res.json.agent.soul).toContain('You are Hermes Agent.');
    expect(res.json.agent.soul).not.toContain('fake-soul-token-1234567890');
    expect(res.json.agent.soul).toContain('«secret:');
    expect(res.json.agent.activeWorkers).toEqual([]);
  });

  it('keeps /agents/profiles for the selectors, and a profile named "profiles" has its own detail', async () => {
    const t = await testApp();
    await t.request('POST', BASE, { name: 'profiles' });
    expect((await t.request('GET', `${BASE}/profiles`)).json.profiles).toEqual(['default', 'profiles']);
    expect((await t.request('GET', `${BASE}/profiles/detail`)).json.agent.name).toBe('profiles');
    expect((await t.request('GET', `${BASE}/inconnu/detail`)).status).toBe(404);
  });

  it('lists the active workers of an agent in its detail', async () => {
    const t = await testApp();
    await worker(t, 'default', 'Veille stuck');
    const res = await t.request('GET', `${BASE}/default/detail`);
    expect(res.json.agent.activeWorkers).toMatchObject([{ board: 'default', taskTitle: 'Veille stuck', assignee: 'default' }]);
  });
});

describe('agents: administration (lot 8 B)', () => {
  it('creates with full copy, no bundled skills, SOUL and model; never the forbidden fields', async () => {
    const t = await testApp();
    const res = await t.request('POST', BASE, {
      name: 'copie', cloneFrom: 'default', cloneAll: true, noSkills: true, soul: 'Tu es bref.', provider: 'openrouter', model: 'openai/gpt-5',
    });
    expect(res.status).toBe(201);
    expect(res.json.modelError).toBeNull();
    const body = dash(t, 'POST', '/api/profiles').at(-1)?.body as Record<string, unknown>;
    expect(body).toEqual({ name: 'copie', description: '', clone_from: 'default', clone_all: true, no_skills: true, soul: 'Tu es bref.', provider: 'openrouter', model: 'openai/gpt-5' });
    for (const k of ['clone_channels', 'mcp_servers', 'hub_skills', 'keep_skills', 'api_key']) expect(body).not.toHaveProperty(k);
    // clone_all only with an explicit source; provider and model together
    await t.request('POST', BASE, { name: 'seul', cloneAll: true });
    expect(dash(t, 'POST', '/api/profiles').at(-1)?.body).not.toHaveProperty('clone_all');
    expect((await t.request('POST', BASE, { name: 'moitie', model: 'x' })).status).toBe(400);
  });

  it('reports a model refused at creation, the agent stays', async () => {
    const t = await testApp();
    const res = await t.request('POST', BASE, { name: 'mauvais', provider: 'openrouter', model: 'refuse/x' });
    expect(res.status).toBe(201);
    expect(res.json.modelError).toContain('not available');
    expect((await t.request('GET', BASE)).json.agents.map((a: any) => a.name)).toContain('mauvais');
  });

  it('writes SOUL.md keeping a masked secret; a moved or unknown placeholder is refused', async () => {
    const t = await testApp();
    const shown = (await t.request('GET', `${BASE}/default/detail`)).json.agent.soul as string;
    expect(shown).not.toContain('fake-soul-token-1234567890');
    const marker = /«secret:[0-9a-f]+»/.exec(shown)![0];
    const draft = shown.replace('Keep answers short.', 'Réponds en français.');
    const ok = await t.request('PUT', `${BASE}/default/soul`, { content: draft });
    expect(ok.status).toBe(200);
    expect(ok.json.soul).toContain(marker);
    const written = dash(t, 'PUT', '/api/profiles/default/soul').at(-1)?.body as { content: string };
    expect(written.content).toContain('Bearer fake-soul-token-1234567890');
    expect(written.content).toContain('Réponds en français.');
    const moved = await t.request('PUT', `${BASE}/default/soul`, { content: `Le jeton est ${marker}` });
    expect(moved.status).toBe(400);
    expect(moved.json.code).toBe('secret_moved');
    const unknown = await t.request('PUT', `${BASE}/default/soul`, { content: 'Authorization: Bearer «secret:00000000»' });
    expect(unknown.status).toBe(400);
    expect(unknown.json.code).toBe('secret_placeholder');
    expect(dash(t, 'PUT', '/api/profiles/default/soul')).toHaveLength(1);
  });

  it('refuses to write over a SOUL.md longer than the editor limit', async () => {
    const t = await testApp();
    t.fake.profiles.souls.set('default', 'x'.repeat(64 * 1024 + 10));
    const res = await t.request('PUT', `${BASE}/default/soul`, { content: 'court' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('too_long');
  });

  it('sets the default model and proposes a description', async () => {
    const t = await testApp();
    await t.request('POST', BASE, { name: 'veille' });
    const m = await t.request('PUT', `${BASE}/veille/model`, { provider: 'anthropic', model: 'claude-sonnet-4.6' });
    expect(m.status).toBe(200);
    expect(dash(t, 'PUT', '/api/profiles/veille/model').at(-1)?.body).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4.6' });
    expect((await t.request('PUT', `${BASE}/veille/model`, { provider: 'anthropic', model: 'refuse' })).status).toBe(400);
    const d = await t.request('POST', `${BASE}/veille/describe`);
    expect(d.json).toEqual({ description: 'Agent de test', reason: null });
    expect(dash(t, 'POST', '/api/profiles/veille/describe-auto').at(-1)?.body).toEqual({ overwrite: false });
    await t.request('POST', BASE, { name: 'muet' });
    expect((await t.request('POST', `${BASE}/muet/describe`)).json).toEqual({ description: null, reason: 'no auxiliary model' });
  });

  it('never deletes default nor a profile used by a workspace or a session', async () => {
    const t = await testApp({ profileKeys: { dev: 'dev-profile-key-0000000', solo: 'solo-profile-key-000000' } });
    await t.request('POST', BASE, { name: 'dev' });
    await t.request('POST', BASE, { name: 'solo' });
    const prot = await t.request('DELETE', `${BASE}/default`);
    expect(prot.status).toBe(409);
    expect(prot.json.code).toBe('protected');
    await t.request('POST', '/x/workspaces', { slug: 'ws', name: 'Ws', instanceId: 'fake', profile: 'dev' });
    const used = await t.request('DELETE', `${BASE}/dev`);
    expect(used.status).toBe(409);
    expect(used.json).toMatchObject({ code: 'in_use', workspaces: ['ws'], sessions: 0 });
    await t.request('POST', '/x/workspaces', { slug: 'autre', name: 'Autre', instanceId: 'fake' });
    const s = (await t.request('POST', '/x/workspaces/autre/sessions')).json.session;
    expect((await t.request('PATCH', `/x/sessions/fake/${s.id}`, { profile: 'solo' })).status).toBe(200);
    const bySession = await t.request('DELETE', `${BASE}/solo`);
    expect(bySession.json).toMatchObject({ code: 'in_use', workspaces: [], sessions: 1 });
    expect(dash(t, 'DELETE', '/api/profiles/dev').length + dash(t, 'DELETE', '/api/profiles/solo').length).toBe(0);
    expect((await t.request('DELETE', `${BASE}/Mauvais%20Nom`)).status).toBe(400);
  });

  it('deletes a profile and its Intendia settings; says when its key stays in the environment', async () => {
    const t = await testApp({ profileKeys: { veille: 'veille-profile-key-0000' } });
    const { presets } = await import('../src/chat/presets.js');
    await t.request('POST', BASE, { name: 'veille' });
    presets.setPins(t.db, 'fake', 'veille', [{ provider: 'anthropic', model: 'claude-sonnet-4.6' }]);
    presets.setModes(t.db, 'fake', 'veille', [{ id: 'm1', name: 'Rapide', model: null, provider: null, effort: 'low', personality: null }]);
    presets.setPins(t.db, 'fake', 'default', [{ provider: 'anthropic', model: 'claude-sonnet-4.6' }]);
    const res = await t.request('DELETE', `${BASE}/veille`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, keyLeft: true, pending: false });
    expect(dash(t, 'DELETE', '/api/profiles/veille').at(-1)?.query).toEqual({ profile: 'veille' });
    expect(presets.pins(t.db, 'fake', 'veille')).toEqual([]);
    expect(presets.modes(t.db, 'fake', 'veille')).toEqual([]);
    expect(presets.pins(t.db, 'fake', 'default')).toHaveLength(1);
    expect((await t.request('GET', BASE)).json.agents.map((a: any) => a.name)).not.toContain('veille');
    await t.request('POST', BASE, { name: 'lent' });
    expect((await t.request('DELETE', `${BASE}/lent`)).json).toEqual({ ok: true, keyLeft: false, pending: true });
  });
});

describe('agents: model list of any agent', () => {
  it('chat-models?for=agent reads the models of a profile without chat key', async () => {
    const t = await testApp();
    await t.request('POST', BASE, { name: 'veille' });
    expect((await t.request('GET', '/x/i/fake/chat-models?profile=veille')).status).toBe(400);
    const res = await t.request('GET', '/x/i/fake/chat-models?profile=veille&for=agent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.groups)).toBe(true);
    expect((await t.request('GET', '/x/i/fake/chat-models?profile=..%2Fx&for=agent')).status).toBe(400);
  });
});
