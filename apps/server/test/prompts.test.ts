import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('prompts', () => {
  it('create, list by kind and title, update, delete', async () => {
    const t = await testApp();
    const a = await t.request('POST', '/x/prompts', { title: ' Relire ', body: 'Relis ce texte.' });
    expect(a.status).toBe(201);
    expect(a.json.prompt).toMatchObject({ kind: 'prompt', title: 'Relire', body: 'Relis ce texte.' });
    await t.request('POST', '/x/prompts', { title: 'Avocat', body: 'Contredis-moi.', kind: 'personality' });
    await t.request('POST', '/x/prompts', { title: 'Analyse', body: 'Analyse.' });
    expect((await t.request('GET', '/x/prompts?kind=prompt')).json.prompts.map((p: any) => p.title)).toEqual(['Analyse', 'Relire']);
    expect((await t.request('GET', '/x/prompts')).json.prompts).toHaveLength(3);
    const id = a.json.prompt.id;
    const up = await t.request('PATCH', `/x/prompts/${id}`, { title: 'Relecture' });
    expect(up.json.prompt).toMatchObject({ title: 'Relecture', body: 'Relis ce texte.' });
    expect((await t.request('DELETE', `/x/prompts/${id}`)).status).toBe(200);
    expect((await t.request('DELETE', `/x/prompts/${id}`)).status).toBe(404);
    expect((await t.request('PATCH', `/x/prompts/${id}`, { body: 'x' })).status).toBe(404);
  });

  it('limits: empty or long title, empty or long body, unknown kind', async () => {
    const t = await testApp();
    const post = (b: object) => t.request('POST', '/x/prompts', b);
    expect((await post({ title: '  ', body: 'x' })).status).toBe(400);
    expect((await post({ title: 'x'.repeat(81), body: 'x' })).status).toBe(400);
    expect((await post({ title: 'x', body: ' ' })).status).toBe(400);
    expect((await post({ title: 'x', body: 'x'.repeat(20_001) })).status).toBe(400);
    expect((await post({ title: 'x', body: 'x', kind: 'autre' })).status).toBe(400);
    expect((await post({ title: 'x'.repeat(80), body: 'x'.repeat(20_000) })).status).toBe(201);
    expect((await t.request('GET', '/x/prompts?kind=autre')).status).toBe(400);
  });
});
