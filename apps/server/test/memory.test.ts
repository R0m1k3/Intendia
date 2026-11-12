import { describe, expect, it } from 'vitest';
import { FAKE_MEMORY_SEED, memoryFingerprint } from 'fake-hermes';
import { testApp } from './helpers.js';

const M = '/x/i/fake/memory';
type T = Awaited<ReturnType<typeof testApp>>;
const dashCalls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);
const idOf = (source: 'memory' | 'profile', local: number) => {
  const global = source === 'memory' ? local : FAKE_MEMORY_SEED.memory.length + local;
  return `memory:${source}:${global}:${memoryFingerprint(FAKE_MEMORY_SEED[source][local]!)}`;
};
const SECRET = 'fake-memory-token-1234567890';

describe('memory: overview', () => {
  it('lists the masked entries of both files, usage with limits, learned skills and their links', async () => {
    const t = await testApp();
    const res = await t.request('GET', M);
    expect(res.status).toBe(200);
    const m = res.json;
    expect(m.active).toBeNull();
    expect(m.entries).toHaveLength(6);
    expect(m.entries.filter((e: any) => e.source === 'profile')).toHaveLength(2);
    expect(m.entries[0]).toMatchObject({ id: idOf('memory', 0), title: 'Le serveur de production s’appelle atlas.' });
    expect(JSON.stringify(m)).not.toContain(SECRET);
    expect(m.entries[1].excerpt).toContain('«secret:');
    expect(m.usage.memory.limit).toBe(2200);
    expect(m.usage.user.limit).toBe(1375);
    expect(m.usage.memory.bytes).toBeGreaterThan(100);
    expect(m.skills).toHaveLength(4);
    expect(m.skills[0].related).toEqual([m.skills[1].name]);
    expect(m.skills[0].memories).toEqual([idOf('memory', 0)]);
    expect(m.entries[0].skills).toEqual([m.skills[0].name]);
    expect(m.stats).toMatchObject({ skills: 4, links: 1 });
  });

  it('reads the limits from the profile config', async () => {
    const t = await testApp();
    const put = await t.request('PUT', '/x/i/fake/config', { changes: { 'memory.memory_char_limit': 3000 }, version: (await t.request('GET', '/x/i/fake/config')).json.version });
    expect(put.status).toBe(200);
    const m = (await t.request('GET', M)).json;
    expect(m.usage.memory.limit).toBe(3000);
  });

  it('is unavailable without the graph; usage unknown without /api/memory', async () => {
    const t = await testApp({ hide: { openapi: ['GET /api/learning/graph'] } });
    const report = ((await t.request('GET', '/x/compat')).json).reports[0];
    expect(report.modules.find((x: { id: string }) => x.id === 'memory').state).toBe('unavailable');
    const t2 = await testApp({ breaks: { 'dash GET /api/memory': { status: 500 } } });
    const m = (await t2.request('GET', M)).json;
    expect(m.usage).toEqual({ memory: null, user: null });
    expect(m.entries).toHaveLength(6);
  });
});

describe('memory: entries', () => {
  it('reads an entry masked; refuses a bad id before Hermes', async () => {
    const t = await testApp();
    const e = await t.request('GET', `${M}/entry?id=${encodeURIComponent(idOf('memory', 1))}`);
    expect(e.status).toBe(200);
    expect(e.json.content).toContain('«secret:');
    expect(e.json.content).not.toContain(SECRET);
    const n = dashCalls(t, 'GET', '/api/learning/node').length;
    expect((await t.request('GET', `${M}/entry?id=atlas`)).status).toBe(400);
    expect((await t.request('DELETE', `${M}/entry?id=memory:memory:1:zz`)).status).toBe(400);
    expect(dashCalls(t, 'GET', '/api/learning/node')).toHaveLength(n);
  });

  it('edits an entry keeping its masked secret; an unknown placeholder is refused', async () => {
    const t = await testApp();
    const id = idOf('memory', 1);
    const shown = (await t.request('GET', `${M}/entry?id=${encodeURIComponent(id)}`)).json.content as string;
    const res = await t.request('PUT', `${M}/entry`, { id, content: `${shown} (nouvelle clé en janvier)` });
    expect(res.status).toBe(200);
    const sent = dashCalls(t, 'PUT', '/api/learning/node').at(-1)!.body as { id: string; content: string; profile: string };
    expect(sent).toMatchObject({ id, profile: 'default' });
    expect(sent.content).toBe(`${FAKE_MEMORY_SEED.memory[1]} (nouvelle clé en janvier)`);
    expect(t.fake.memory.entries('default').memory[1]).toContain(SECRET);
    const bad = await t.request('PUT', `${M}/entry`, { id: idOf('memory', 0), content: 'texte «secret:0123abcd»' });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('secret_placeholder');
  });

  it('empty → refused; stale → 409; over budget → 400 over_budget', async () => {
    const t = await testApp();
    expect((await t.request('PUT', `${M}/entry`, { id: idOf('memory', 0), content: '  ' })).status).toBe(400);
    // the "instable" entry changes after every read: the read of the edit finds it gone
    const unstable = idOf('memory', 2);
    expect((await t.request('GET', `${M}/entry?id=${encodeURIComponent(unstable)}`)).status).toBe(200);
    const stale = await t.request('PUT', `${M}/entry`, { id: unstable, content: 'autre' });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('stale');
    const over = await t.request('PUT', `${M}/entry`, { id: idOf('profile', 0), content: 'x'.repeat(1400) });
    expect(over.status).toBe(400);
    expect(over.json.code).toBe('over_budget');
    expect(over.json.error).toContain('1,375');
  });

  it('deletes with a JSON body and the profile', async () => {
    const t = await testApp();
    const id = idOf('profile', 1);
    const res = await t.request('DELETE', `${M}/entry?id=${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    const call = dashCalls(t, 'DELETE', '/api/learning/node').at(-1)!;
    expect(call.body).toEqual({ id, profile: 'default' });
    expect(call.query).toEqual({ profile: 'default' });
    expect((await t.request('GET', M)).json.entries).toHaveLength(5);
    expect((await t.request('DELETE', `${M}/entry?id=${encodeURIComponent(id)}`)).json.code).toBe('stale');
  });

  it('another profile has its own (empty) memory', async () => {
    const t = await testApp();
    await t.request('POST', '/x/i/fake/agents', { name: 'recherche' });
    const m = (await t.request('GET', `${M}?profile=recherche`)).json;
    expect(m.entries).toEqual([]);
    expect(m.skills).toEqual([]);
  });
});
