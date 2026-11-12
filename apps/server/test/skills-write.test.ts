import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/skills';
type T = Awaited<ReturnType<typeof testApp>>;
const dashCalls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);
const create = (t: T, over: Record<string, unknown> = {}) =>
  t.request('POST', BASE, { name: 'rapport-hebdo', category: 'notes', description: 'Rédige le rapport: hebdomadaire', body: '# Rapport\n\nFais le point.', ...over });

describe('skills: write (lot 8 C)', () => {
  it('creates a skill with an escaped front matter', async () => {
    const t = await testApp();
    const res = await create(t);
    expect(res.status).toBe(201);
    expect(res.json.skill).toMatchObject({ name: 'rapport-hebdo', provenance: 'agent', category: 'notes' });
    const sent = dashCalls(t, 'POST', '/api/skills').at(-1)!.body as { name: string; content: string; category: string };
    expect(sent.category).toBe('notes');
    // the colon in the description is quoted by the YAML writer
    expect(sent.content).toBe("---\nname: rapport-hebdo\ndescription: \"Rédige le rapport: hebdomadaire\"\n---\n\n# Rapport\n\nFais le point.\n");
  });

  it('refuses a long description, a bad name, an empty body before Hermes', async () => {
    const t = await testApp();
    expect((await create(t, { description: 'x'.repeat(61) })).status).toBe(400);
    expect((await create(t, { description: 'deux\nlignes' })).status).toBe(400);
    expect((await create(t, { name: 'Mauvais Nom' })).status).toBe(400);
    expect((await create(t, { body: '   ' })).status).toBe(400);
    expect(dashCalls(t, 'POST', '/api/skills')).toHaveLength(0);
  });

  it('an existing name: Hermes refusal without its host path', async () => {
    const t = await testApp();
    await create(t);
    const dup = await create(t);
    expect(dup.status).toBe(400);
    expect(dup.json.error).toContain('already exists');
    expect(dup.json.error).not.toContain('/opt/data');
  });

  it('edits a user skill keeping a masked secret; refuses a bundled one', async () => {
    const t = await testApp();
    await create(t, { body: 'Appelle l’API avec Authorization: Bearer sk-skill-secret-0123456789abcdef' });
    const shown = (await t.request('GET', `${BASE}/content?name=rapport-hebdo`)).json.content as string;
    expect(shown).not.toContain('sk-skill-secret');
    expect(shown).toContain('«secret:');
    const put = await t.request('PUT', `${BASE}/content`, { name: 'rapport-hebdo', content: `${shown}\nAjout.\n` });
    expect(put.status).toBe(200);
    expect(put.json.content).not.toContain('sk-skill-secret');
    const written = dashCalls(t, 'PUT', '/api/skills/content').at(-1)!.body as { content: string };
    expect(written.content).toContain('Bearer sk-skill-secret-0123456789abcdef');
    expect(written.content).toContain('Ajout.');
    const bundled = t.fake.skills.skills.find((s) => s.provenance === 'bundled')!.name;
    const refused = await t.request('PUT', `${BASE}/content`, { name: bundled, content: '---\nname: x\n---\nx' });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('protected');
    expect((await t.request('PUT', `${BASE}/content`, { name: 'rapport-hebdo', content: 'sans en-tête' })).status).toBe(400);
  });

  it('locks and unlocks', async () => {
    const t = await testApp();
    await create(t);
    expect((await t.request('PUT', `${BASE}/lock`, { name: 'rapport-hebdo', locked: true })).json.skill.locked).toBe(true);
    expect((await t.request('PUT', `${BASE}/lock`, { name: 'rapport-hebdo', locked: false })).json.skill.locked).toBe(false);
    expect((await t.request('PUT', `${BASE}/lock`, { name: 'absent', locked: true })).status).toBe(404);
  });

  it('archives a user skill with the profile; never a bundled or hub one; a pinned refusal is shown', async () => {
    const t = await testApp();
    await create(t);
    const res = await t.request('DELETE', `${BASE}/rapport-hebdo?profile=default`);
    expect(res.status).toBe(200);
    const call = dashCalls(t, 'DELETE', '/api/learning/node').at(-1)!;
    expect(call.body).toEqual({ id: 'rapport-hebdo', profile: 'default' });
    expect(call.query).toEqual({ profile: 'default' });
    expect((await t.request('GET', BASE)).json.skills.some((s: any) => s.name === 'rapport-hebdo')).toBe(false);
    const bundled = t.fake.skills.skills.find((s) => s.provenance === 'bundled')!.name;
    expect((await t.request('DELETE', `${BASE}/${bundled}`)).json.code).toBe('protected');
    await create(t, { name: 'epingle' });
    const pinned = await t.request('DELETE', `${BASE}/epingle`);
    expect(pinned.status).toBe(400);
    expect(pinned.json.error).toContain('pinned');
  });
});
