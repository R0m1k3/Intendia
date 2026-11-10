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
    expect(res.json).toEqual({ name: 'veille', keySource: 'env' });
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
