import { describe, expect, it } from 'vitest';
import { actionName } from '../src/connectors/skills/index.js';
import { lastRunLines } from '../src/skills/service.js';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/skills';
type T = Awaited<ReturnType<typeof testApp>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dashCalls = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.via === 'dash' && r.method === method && r.path === path);

async function waitDone(t: T, action: string) {
  for (let i = 0; i < 200; i++) {
    const s = (await t.request('GET', `${BASE}/hub/actions/${action}`)).json;
    if (!s.running) return s;
    await sleep(5);
  }
  throw new Error('action did not finish');
}

describe('skills: list, toggle, content, toolsets', () => {
  it('lists the dashboard skills with the public shape and passes the profile', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${BASE}?profile=default`);
    expect(res.status).toBe(200);
    expect(res.json.skills).toHaveLength(39);
    expect(res.json.skills[0]).toEqual({
      name: 'claude-code', description: 'Delegate coding to Claude Code CLI (features, PRs).', category: 'autonomous-ai-agents',
      enabled: true, provenance: 'bundled', usage: 0, locked: false,
    });
    expect(dashCalls(t, 'GET', '/api/skills').at(-1)?.query).toMatchObject({ profile: 'default' });
    expect((await t.request('GET', `${BASE}?profile=bad%20name`)).status).toBe(400);
  });

  it("maps Hermes' unknown-profile 404 to a 404 with its message", async () => {
    // a non-probed route: breaking the list would also fail the startup probe
    const t = await testApp({ breaks: { 'dash GET /api/skills/content': { status: 404, body: { detail: "Profile 'nope' does not exist." } } } });
    const res = await t.request('GET', `${BASE}/content?name=claude-code&profile=nope`);
    expect(res.status).toBe(404);
    expect(res.json.error).toContain("Profile 'nope' does not exist.");
  });

  it('falls back to /v1/skills ({data}) without the enabled state', async () => {
    const t = await testApp({
      hide: { openapi: ['GET /api/skills', 'GET /api/tools/toolsets'] },
      breaks: { 'api GET /v1/skills': { status: 200, body: { data: [{ name: 'x', description: 'd', category: 'c' }] } } },
    });
    const res = await t.request('GET', BASE);
    expect(res.json.skills).toEqual([{ name: 'x', description: 'd', category: 'c', enabled: null, provenance: null, usage: 0, locked: false }]);
    // /v1/toolsets labels carry an emoji
    const ts = (await t.request('GET', `${BASE}/toolsets`)).json.toolsets;
    expect(ts[0].label).toBe('Web Search & Scraping');
  });

  it('without the fallback body, the broken /v1/skills makes the list unavailable (409)', async () => {
    const t = await testApp({ hide: { openapi: ['GET /api/skills'] } });
    expect((await t.request('GET', BASE)).status).toBe(409);
  });

  it('refuses to toggle an unknown name without calling Hermes, toggles a known one', async () => {
    const t = await testApp();
    const unknown = await t.request('PUT', `${BASE}/enabled`, { name: 'nope-xyz', enabled: false });
    expect(unknown.status).toBe(404);
    expect(dashCalls(t, 'PUT', '/api/skills/toggle')).toHaveLength(0);

    const res = await t.request('PUT', `${BASE}/enabled?profile=default`, { name: 'claude-code', enabled: false });
    expect(res.status).toBe(200);
    expect(res.json.skill).toMatchObject({ name: 'claude-code', enabled: false });
    expect(dashCalls(t, 'PUT', '/api/skills/toggle')[0]?.body).toEqual({ name: 'claude-code', enabled: false });
    // names may contain "/" (same-tier duplicates): they travel in the body
    expect((await t.request('PUT', `${BASE}/enabled`, { name: 'cat/dup', enabled: true })).status).toBe(404);
    expect((await t.request('PUT', `${BASE}/enabled`, { name: '../x y', enabled: true })).status).toBe(400);
  });

  it('returns SKILL.md without the Hermes path, truncated past the limit', async () => {
    const t = await testApp();
    const res = await t.request('GET', `${BASE}/content?name=claude-code`);
    expect(res.json).toMatchObject({ name: 'claude-code', truncated: false });
    expect(res.json.content).toContain('requires_toolsets: [terminal]');
    expect(res.json).not.toHaveProperty('path');
    expect((await t.request('GET', `${BASE}/content?name=missing`)).status).toBe(404);

    const big = await testApp({ breaks: { 'dash GET /api/skills/content': { body: { name: 'big', content: 'a'.repeat(200_010) } } } });
    const r = (await big.request('GET', `${BASE}/content?name=big`)).json;
    expect(r.truncated).toBe(true);
    expect(r.content).toHaveLength(200_000);
  });

  it('reads toolsets from the dashboard first', async () => {
    const t = await testApp();
    const ts = (await t.request('GET', `${BASE}/toolsets`)).json.toolsets;
    expect(ts).toHaveLength(27);
    expect(ts[0]).toEqual({
      name: 'web', label: 'Web Search & Scraping', description: 'web_search, web_extract', enabled: true, configured: true, tools: ['web_extract', 'web_search'],
    });
    expect(dashCalls(t, 'GET', '/api/tools/toolsets').length).toBeGreaterThan(0);
  });
});

describe('skills: hub', () => {
  it('lists the official catalogue and searches the hub', async () => {
    const t = await testApp();
    const off = (await t.request('GET', `${BASE}/hub/official`)).json;
    expect(off.results).toHaveLength(3);
    expect(off.results[0]).toMatchObject({ identifier: 'official/autonomous-ai-agents/agent-merge-conflict-arbiter', trust: 'builtin', installed: false });

    const res = (await t.request('GET', `${BASE}/hub/search?q=skill%20lent`)).json;
    expect(res.timedOut).toEqual(['github']);
    expect(res.results.map((r: { identifier: string }) => r.identifier)).toEqual(['fake/caution-skill', 'fake/dangerous-skill']);
    expect(dashCalls(t, 'GET', '/api/skills/hub/search')[0]?.query).toMatchObject({ q: 'skill lent' });
    expect((await t.request('GET', `${BASE}/hub/search?q=`)).status).toBe(400);
  });

  it('relays a scan and its 404', async () => {
    const t = await testApp();
    const scan = (await t.request('GET', `${BASE}/hub/scan?identifier=fake/caution-skill`)).json.scan;
    expect(scan).toMatchObject({ verdict: 'caution', policy: 'ask', trust: 'community', counts: { medium: 1 } });
    expect(scan.findings).toHaveLength(1);
    expect((await t.request('GET', `${BASE}/hub/scan?identifier=fake/none`)).status).toBe(404);
  });

  it('installs an allowed skill and follows the action to the end', async () => {
    const t = await testApp();
    const id = 'official/autonomous-ai-agents/blackbox';
    const res = await t.request('POST', `${BASE}/hub/install?profile=default`, { identifier: id });
    expect(res.status).toBe(202);
    expect(res.json.action).toBe(actionName('install', id));
    expect(dashCalls(t, 'POST', '/api/skills/hub/install')[0]?.body).toEqual({ identifier: id });
    const done = await waitDone(t, res.json.action);
    expect(done).toMatchObject({ running: false, exitCode: 0, truncated: false });
    expect(done.lines.at(-1)).toContain('Installed:');
    const skills = (await t.request('GET', BASE)).json.skills;
    expect(skills.find((s: { name: string }) => s.name === 'blackbox')).toMatchObject({ provenance: 'hub', enabled: true });
    const off = (await t.request('GET', `${BASE}/hub/official`)).json.results;
    expect(off.find((r: { name: string }) => r.name === 'blackbox').installed).toBe(true);
  });

  it('asks for consent on "ask", refuses "block" and unknown policies, without starting an install', async () => {
    const t = await testApp();
    const ask = await t.request('POST', `${BASE}/hub/install`, { identifier: 'fake/caution-skill' });
    expect(ask.status).toBe(409);
    expect(ask.json).toMatchObject({ code: 'scan_refused', scan: { policy: 'ask' } });
    const block = await t.request('POST', `${BASE}/hub/install`, { identifier: 'fake/dangerous-skill', acknowledged: true });
    expect(block.status).toBe(409);
    expect(block.json.scan.policy).toBe('block');
    expect(dashCalls(t, 'POST', '/api/skills/hub/install')).toHaveLength(0);

    const ok = await t.request('POST', `${BASE}/hub/install`, { identifier: 'fake/caution-skill', acknowledged: true });
    expect(ok.status).toBe(202);

    const odd = await testApp({ breaks: { 'dash GET /api/skills/hub/scan': { body: { verdict: 'new', policy: 'review' } } } });
    const r = await odd.request('POST', `${BASE}/hub/install`, { identifier: 'fake/caution-skill', acknowledged: true });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('scan_refused');
    const failed = await testApp({ breaks: { 'dash GET /api/skills/hub/scan': { status: 502 } } });
    expect((await failed.request('POST', `${BASE}/hub/install`, { identifier: 'fake/caution-skill' })).status).toBe(502);
    expect(dashCalls(failed, 'POST', '/api/skills/hub/install')).toHaveLength(0);
  });

  it('refuses a second start while the same action runs', async () => {
    const t = await testApp({ skillStepMs: 200 });
    expect((await t.request('POST', `${BASE}/hub/update`)).status).toBe(202);
    const again = await t.request('POST', `${BASE}/hub/update?profile=other`);
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'busy', action: 'skills-update' });
  });

  it('uninstalls, reports a failed uninstall and updates', async () => {
    const t = await testApp();
    const bad = await t.request('POST', `${BASE}/hub/uninstall`, { name: 'claude-code' });
    expect(bad.status).toBe(202);
    expect(dashCalls(t, 'POST', '/api/skills/hub/uninstall')[0]?.body).toEqual({ name: 'claude-code' });
    const s = await waitDone(t, bad.json.action);
    expect(s.exitCode).toBe(1);
    expect(s.lines.at(-1)).toContain("Error: 'claude-code' is not a hub-installed skill");

    const up = await t.request('POST', `${BASE}/hub/update`);
    expect(up.json.action).toBe('skills-update');
    expect((await waitDone(t, 'skills-update')).lines).toEqual(['No updates available.']);
  });

  it('validates action names and maps an unknown action to 404', async () => {
    const t = await testApp();
    expect((await t.request('GET', `${BASE}/hub/actions/hermes-update`)).status).toBe(400);
    expect((await t.request('GET', `${BASE}/hub/actions/skills-install-nope-00000000`)).status).toBe(404);
  });

  it('without a dashboard every skills route answers 409', async () => {
    const t = await testApp({ instance: { dashboard: undefined, dashboardToken: undefined } });
    expect((await t.request('GET', BASE)).status).toBe(409);
    expect((await t.request('POST', `${BASE}/hub/update`)).status).toBe(409);
    expect((await t.request('GET', `${BASE}/hub/official`)).status).toBe(409);
  });
});

describe('skills: helpers and profiles', () => {
  it('computes Hermes action names (checked against real names and the Python rule)', () => {
    expect(actionName('install', 'official/security/1password')).toBe('skills-install-official-security-1password-263538a0');
    expect(actionName('uninstall', '1password')).toBe('skills-uninstall-1password-8ad742ee');
    expect(actionName('install', '/Owner/Repo-')).toBe('skills-install-owner-repo-524c930a');
    expect(actionName('uninstall', '---')).toBe('skills-uninstall-skill-58b63e27');
  });

  it('keeps only the last run of an action log, capped', () => {
    const lines = ['', '=== a started 1 ===', '', 'old', '', '=== a started 2 ===', '', 'new', 'x'.repeat(400), ''];
    const out = lastRunLines('a', lines);
    expect(out.truncated).toBe(false);
    expect(out.lines).toEqual(['new', `${'x'.repeat(300)}…`]);
    const cut = lastRunLines('a', Array.from({ length: 30 }, (_, i) => `l${i}`));
    expect(cut).toMatchObject({ truncated: true });
    expect(cut.lines).toHaveLength(20);
  });

  it('lists profiles from the dashboard, else default plus keyed profiles', async () => {
    const t = await testApp();
    expect((await t.request('GET', '/x/i/fake/agents/profiles')).json).toEqual({ profiles: ['default'] });
    const off = await testApp({ hide: { openapi: ['GET /api/profiles', 'GET /api/plugins/kanban/profiles'] }, profileKeys: { coder: 'coder-key-0123456789' } });
    expect((await off.request('GET', '/x/i/fake/agents/profiles')).json).toEqual({ profiles: ['default', 'coder'] });
  });
});
