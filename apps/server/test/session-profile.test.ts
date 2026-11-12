import { describe, expect, it } from 'vitest';
import { testApp, waitRun } from './helpers.js';

const DEV_KEY = 'dev-profile-key-0000000';
type T = Awaited<ReturnType<typeof testApp>>;

async function setup() {
  const t = await testApp({ profileKeys: { dev: DEV_KEY } });
  await t.request('POST', '/x/workspaces', { slug: 'ws', name: 'Ws', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/ws/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}
const send = async (t: T, base: string, input: string) => {
  const r = await t.request('POST', `${base}/runs`, { input });
  expect(r.status).toBe(200);
  await waitRun(t, base, r.json.runId);
  return r.json.runId as string;
};
const lastRunPost = (t: T) => t.fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/runs').at(-1)!;

describe('profile per session', () => {
  it('a session never sent changes profile by PATCH; its runs go to that profile', async () => {
    const { t, base } = await setup();
    const p = await t.request('PATCH', base, { profile: 'dev' });
    expect(p.status).toBe(200);
    expect(p.json.session.profile).toBe('dev');
    expect((await t.request('GET', base)).json.profile).toBe('dev');
    await send(t, base, 'Bonjour');
    expect(lastRunPost(t).profile).toBe('dev');
    expect(lastRunPost(t).authorization).toBe(`Bearer ${DEV_KEY}`);
    // with a history: copy instead
    expect((await t.request('PATCH', base, { profile: null })).json.code).toBe('has_history');
    expect((await t.request('PATCH', base, { profile: 'nokey' })).status).toBe(409);
  });

  it('PATCH: a copy (copiedFrom) has a history; a profile without key → 400', async () => {
    const { t, base, s } = await setup();
    expect((await t.request('PATCH', base, { profile: 'nokey' })).json.code).toBe('no_key');
    await send(t, base, 'Bonjour');
    const dup = (await t.request('POST', `${base}/duplicate`, { key: 'cle-dupl-0001' })).json.session;
    expect(dup.copiedFrom).toBe(s.id);
    expect((await t.request('PATCH', `/x/sessions/fake/${dup.id}`, { profile: 'dev' })).json.code).toBe('has_history');
  });

  it('to-profile: full copy in the other profile, same key = same copy; same profile, no key, run going refused', async () => {
    const { t, s, base } = await setup();
    await t.request('PATCH', base, { title: 'Promo', personality: 'hermes:brief', autoApprove: true, effort: 'low' });
    await send(t, base, 'Prépare la promo');
    expect((await t.request('POST', `${base}/to-profile`, { key: 'cle-prof-0001', profile: 'default' })).json.code).toBe('same_profile');
    expect((await t.request('POST', `${base}/to-profile`, { key: 'cle-prof-0001', profile: 'nokey' })).json.code).toBe('no_key');
    const res = await t.request('POST', `${base}/to-profile`, { key: 'cle-prof-0001', profile: 'dev' });
    expect(res.status).toBe(201);
    const copy = res.json.session;
    expect(copy).toMatchObject({ profile: 'dev', copiedFrom: s.id, workspace: 'ws', title: 'Promo', effort: 'low', autoApprove: false });
    // the fake's config is the same for every profile: the Hermes personality exists there too
    expect(copy.personality).toBe('hermes:brief');
    const again = await t.request('POST', `${base}/to-profile`, { key: 'cle-prof-0001', profile: 'dev' });
    expect(again.status).toBe(200);
    expect(again.json.session.id).toBe(copy.id);
    const imported = t.fake.requests.filter((r) => r.method === 'POST' && r.path === '/api/sessions/import').at(-1)!;
    expect((imported.body as { profile?: string }).profile).toBe('dev');
    // the original stays
    expect((await t.request('GET', base)).status).toBe(200);

    const cbase = `/x/sessions/fake/${copy.id}`;
    await send(t, cbase, 'Et les horaires');
    expect(lastRunPost(t).profile).toBe('dev');
    const list = (await t.request('GET', '/x/workspaces/ws/sessions')).json.sessions;
    expect(list.map((x: any) => x.id)).toContain(copy.id);
    const recent = (await t.request('GET', '/x/i/fake/sessions/recent')).json;
    expect(JSON.stringify(recent)).toContain(copy.id);

    // Duplicate keeps the profile; Move to a workspace of the default profile is refused
    const dup = (await t.request('POST', `${cbase}/duplicate`, { key: 'cle-dupl-0002' })).json.session;
    expect(dup.profile).toBe('dev');
    await t.request('POST', '/x/workspaces', { slug: 'autre', name: 'Autre', instanceId: 'fake' });
    const moved = await t.request('POST', '/x/i/fake/sessions/bulk', { action: 'move', ids: [copy.id], workspace: 'autre' });
    expect(JSON.stringify(moved.json)).toContain('Autre agent');

    // a run going: no copy
    const going = await t.request('POST', `${cbase}/runs`, { input: 'lent' });
    const busy = await t.request('POST', `${cbase}/to-profile`, { key: 'cle-prof-0002', profile: 'default' });
    expect(busy.json.code).toBe('run_active');
    await t.request('POST', `${cbase}/runs/${going.json.runId}/stop`, {});
  });

  it('« Sans confirmation » stays on a replacement (retry), not on a branch nor a duplicate', async () => {
    const { t, s, base } = await setup();
    await t.request('PATCH', base, { autoApprove: true, profile: 'dev' });
    await send(t, base, 'Premier');
    await send(t, base, 'Second');
    const msgs = (await t.request('GET', `${base}/messages`)).json.messages.filter((m: any) => m.role === 'user');
    const retry = (await t.request('POST', `${base}/rewrite`, { key: 'cle-retry-001', before: msgs[1].id, mode: 'replace' })).json.session;
    expect(retry).toMatchObject({ autoApprove: true, profile: 'dev' });
    const rbase = `/x/sessions/fake/${retry.id}`;
    await send(t, rbase, 'Second bis');
    const m2 = (await t.request('GET', `${rbase}/messages`)).json.messages.filter((m: any) => m.role === 'user');
    const branch = (await t.request('POST', `${rbase}/rewrite`, { key: 'cle-branch-01', before: m2[1].id, mode: 'branch' })).json.session;
    expect(branch).toMatchObject({ autoApprove: false, profile: 'dev' });
    const dup = (await t.request('POST', `${rbase}/duplicate`, { key: 'cle-dupl-0003' })).json.session;
    expect(dup.autoApprove).toBe(false);
    expect(s.id).not.toBe(retry.id);
  });

  it('a deleted session of another profile is purged in that profile; approvals read there', async () => {
    const { t, base, s } = await setup();
    await t.request('PATCH', base, { profile: 'dev' });
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    for (let i = 0; i < 50 && (await t.request('GET', `${base}/runs/${run}`)).json.status !== 'waiting_for_approval'; i++) await new Promise((r) => setTimeout(r, 20));
    const approvals = (await t.request('GET', '/x/approvals')).json.approvals;
    expect(approvals.map((a: any) => a.sessionId)).toContain(s.id);
    await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'deny' });
    await waitRun(t, base, run);
    await t.request('DELETE', base);
    await t.services.purger.sweep(Date.now() + 60_000);
    const del = t.fake.requests.filter((r) => r.method === 'DELETE' && r.path.includes(s.id)).at(-1)!;
    expect(del.profile).toBe('dev');
  });
});
