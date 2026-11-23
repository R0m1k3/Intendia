import { describe, expect, it } from 'vitest';
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
