import { describe, expect, it } from 'vitest';
import { titleCandidates } from '../src/workspaces/title.js';
import { testApp, waitRun } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;
const hermesTitle = async (t: T, id: string) => (await (await t.fake.api.request(`/_fake/sessions/${id}/title`)).json()).title;

// Hermes 0.23 keeps session titles unique (index on sessions.title): a duplicate fails an import (503) or a rename
// (400 invalid_title). Intendia keeps its own title and gives Hermes the next « #N ».
describe('titles at Hermes', () => {
  it('numbers like Hermes', () => {
    expect(titleCandidates('Ventes').slice(0, 3)).toEqual(['Ventes', 'Ventes #2', 'Ventes #3']);
    expect(titleCandidates('Ventes #2').slice(0, 3)).toEqual(['Ventes #2', 'Ventes #3', 'Ventes #4']);
    expect(titleCandidates('Ventes')).toHaveLength(20);
  });

  it('copies with a title in use: imported, then numbered at Hermes only', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    const base = `/x/sessions/fake/${s.id}`;
    for (const input of ['Premier', 'Second']) {
      const r = await t.request('POST', `${base}/runs`, { input });
      await waitRun(t, base, r.json.runId);
    }
    await t.request('PATCH', base, { title: 'Ventes' });
    // two duplicates: the same « (copie) » title twice
    const a = (await t.request('POST', `${base}/duplicate`, { key: 'cle-titre-a' })).json.session;
    const b = (await t.request('POST', `${base}/duplicate`, { key: 'cle-titre-b' })).json.session;
    expect([a.title, b.title]).toEqual(['Ventes (copie)', 'Ventes (copie)']);
    expect([await hermesTitle(t, a.id), await hermesTitle(t, b.id)]).toEqual(['Ventes (copie)', 'Ventes (copie) #2']);
    // a replacing copy has its original's title
    const second = ((await t.request('GET', `${base}/messages`)).json.messages as { id: number; role: string }[]).filter((m) => m.role === 'user')[1]!;
    const res = await t.request('POST', `${base}/rewrite`, { key: 'cle-titre-r', before: second.id, mode: 'replace' });
    expect(res.status).toBe(201);
    expect(res.json.session.title).toBe('Ventes');
    expect(await hermesTitle(t, res.json.session.id)).toBe('Ventes #2');
    // a rename to a title in use
    await t.request('PATCH', `/x/sessions/fake/${a.id}`, { title: 'Ventes' });
    expect((await t.request('GET', `/x/sessions/fake/${a.id}`)).json.session.title).toBe('Ventes');
    expect(await hermesTitle(t, a.id)).toBe('Ventes #3');
  });
});
