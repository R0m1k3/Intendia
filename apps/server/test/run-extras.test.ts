import { describe, expect, it } from 'vitest';
import { renderPersonality } from '../src/sessions/personalities.js';
import { skillBlocks, SKILL_CHARS } from '../src/sessions/run-extras.js';
import type { SkillService } from '../src/skills/service.js';
import type { SessionContext } from '../src/workspaces/service.js';
import { testApp, waitRun } from './helpers.js';

const runsPosted = (t: Awaited<ReturnType<typeof testApp>>) => t.fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/runs');
const instructions = (t: Awaited<ReturnType<typeof testApp>>) => (runsPosted(t).at(-1)!.body as Record<string, string>).instructions!;

async function setup() {
  const t = await testApp();
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}

describe('skills asked by /use', () => {
  it('put in the instructions of this run only; an unknown skill stops the send (400)', async () => {
    const { t, base } = await setup();
    const r = await t.request('POST', `${base}/runs`, { input: 'Bonjour', skills: ['claude-code'] });
    expect(r.status).toBe(200);
    expect(instructions(t)).toContain('[Intendia] Skill demandé pour ce message : claude-code');
    expect(instructions(t)).toContain('# claude-code');
    await waitRun(t, base, r.json.runId);
    const next = await t.request('POST', `${base}/runs`, { input: 'Encore' });
    await waitRun(t, base, next.json.runId);
    expect(instructions(t)).not.toContain('Skill demandé');
    const n = runsPosted(t).length;
    const bad = await t.request('POST', `${base}/runs`, { input: 'x', skills: ['absent'] });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('skill_not_found');
    expect(runsPosted(t)).toHaveLength(n);
    expect((await t.request('POST', `${base}/runs`, { input: 'x', skills: ['a', 'b', 'c', 'd'] })).status).toBe(400);
    // qualified names (category/name) pass validation and reach the lookup; `..` never does
    expect((await t.request('POST', `${base}/runs`, { input: 'x', skills: ['outils/absent'] })).json.code).toBe('skill_not_found');
    expect((await t.request('POST', `${base}/runs`, { input: 'x', skills: ['../absent'] })).status).toBe(400);
  });

  it('a long or truncated skill: its start, then the skill_view instruction', async () => {
    const ctx = { instance: { id: 'i' }, profile: 'default' } as SessionContext;
    const long = { content: async () => ({ name: 'x', content: 'a'.repeat(SKILL_CHARS + 10), truncated: false }) } as unknown as SkillService;
    const [b] = await skillBlocks(long, ctx, ['x']);
    expect(b).toContain('a'.repeat(SKILL_CHARS));
    expect(b).not.toContain('a'.repeat(SKILL_CHARS + 1));
    expect(b).toContain('skill_view');
    const cut = { content: async () => ({ name: 'y', content: 'court', truncated: true }) } as unknown as SkillService;
    expect((await skillBlocks(cut, ctx, ['y']))[0]).toContain('skill_view');
  });
});

describe('personality of a session', () => {
  it('rendered like Hermes', () => {
    expect(renderPersonality('Bref.')).toBe('Bref.');
    expect(renderPersonality({ system_prompt: 'Formel.', tone: 'courtois', style: 'complet' })).toBe('Formel.\nTone: courtois\nStyle: complet');
    expect(renderPersonality({})).toBeNull();
  });

  it('listed from the config and Intendia; added to each run; a missing one is left out with a notice', async () => {
    const { t, base } = await setup();
    const own = (await t.request('POST', '/x/prompts', { kind: 'personality', title: 'Avocat du diable', body: 'Contredis-moi.' })).json.prompt;
    const list = (await t.request('GET', '/x/i/fake/personalities')).json;
    expect(list.items.map((i: any) => i.value)).toEqual(['hermes:brief', 'hermes:formel', `intendia:${own.id}`]);
    await t.request('PATCH', base, { personality: 'hermes:formel' });
    const r = await t.request('POST', `${base}/runs`, { input: 'Bonjour' });
    expect(r.json.notice).toBeUndefined();
    expect(instructions(t)).toContain('[Intendia] Personnalité pour cette session : formel\nTu es un assistant formel.\nTone: courtois');
    await waitRun(t, base, r.json.runId);
    await t.request('PATCH', base, { personality: `intendia:${own.id}` });
    const r2 = await t.request('POST', `${base}/runs`, { input: 'Encore' });
    expect(instructions(t)).toContain('Contredis-moi.');
    await waitRun(t, base, r2.json.runId);
    await t.request('DELETE', `/x/prompts/${own.id}`);
    const r3 = await t.request('POST', `${base}/runs`, { input: 'Toujours' });
    expect(r3.status).toBe(200);
    expect(r3.json.notice).toContain('introuvable');
    expect(instructions(t)).not.toContain('Personnalité pour cette session');
    expect((await t.request('PATCH', base, { personality: 'autre' })).status).toBe(400);
  });
});
