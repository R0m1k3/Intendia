import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessionWorkspace } from '../src/db/schema.js';
import { testApp, waitRun } from './helpers.js';

async function setup(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  const base = `/x/sessions/fake/${s.id}`;
  return { t, s, base };
}
const sendAndWait = async (t: Awaited<ReturnType<typeof testApp>>, base: string, input: string) => {
  const r = await t.request('POST', `${base}/runs`, { input });
  await waitRun(t, base, r.json.runId);
};

describe('session copies', () => {
  it('duplicates a session with its history, once per key', async () => {
    const { t, base } = await setup();
    await sendAndWait(t, base, 'Bonjour');
    await t.request('PATCH', base, { title: 'Ventes', model: 'fake/model-pro', effort: 'high' });
    const dup = await t.request('POST', `${base}/duplicate`, { key: 'cle-dupli-1' });
    expect(dup.status).toBe(201);
    expect(dup.json.session).toMatchObject({ title: 'Ventes (copie)', model: 'fake/model-pro', effort: 'high', workspace: 'dev' });
    expect(dup.json.session.copiedFrom).toBeTruthy();
    const again = await t.request('POST', `${base}/duplicate`, { key: 'cle-dupli-1' });
    expect(again.status).toBe(200);
    expect(again.json.session.id).toBe(dup.json.session.id);
    const hist = await t.request('GET', `/x/sessions/fake/${dup.json.session.id}/messages`);
    expect(hist.json.messages.some((m: any) => m.role === 'user' && m.content === 'Bonjour')).toBe(true);
    // the copy takes runs
    await sendAndWait(t, `/x/sessions/fake/${dup.json.session.id}`, 'Et ensuite ?');

    // imported at Hermes but the Intendia row lost (crash between both): Hermes answers 409, the copy is adopted
    t.db.delete(sessionWorkspace).where(eq(sessionWorkspace.sessionId, dup.json.session.id)).run();
    const retry = await t.request('POST', `${base}/duplicate`, { key: 'cle-dupli-1' });
    expect(retry.status).toBe(201);
    expect(retry.json.session.id).toBe(dup.json.session.id);
  });

  it('duplicates a session never sent as a new empty one, and refuses during a run', async () => {
    const { t, base } = await setup();
    const dup = await t.request('POST', `${base}/duplicate`, { key: 'cle-vide-01' });
    expect(dup.status).toBe(201);
    expect(dup.json.session.copiedFrom).toBeNull();
    expect(t.fake.requests.some((r) => r.path.endsWith('/export'))).toBe(false);
    await t.request('POST', `${base}/runs`, { input: 'approval' });
    const busy = await t.request('POST', `${base}/duplicate`, { key: 'cle-run-001' });
    expect(busy.status).toBe(409);
    expect((await t.request('POST', `${base}/duplicate`, { key: 'x' })).status).toBe(400);
  });

  it('continues a cron session in Intendia, only in a workspace of its profile', async () => {
    const { t } = await setup({ profileKeys: { pro: 'pro-key-0123456789abcdef' } });
    await t.request('POST', '/x/workspaces', { slug: 'pro', name: 'Pro', instanceId: 'fake', profile: 'pro' });
    const ext = await t.fake.api.request('/_fake/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'cron_abc', source: 'cron', title: 'Rapport du matin', messages: [{ role: 'user', content: 'Fais le rapport' }, { role: 'assistant', content: 'Voici le rapport' }] }),
    });
    expect(ext.status).toBe(200);
    // the original refuses runs
    const direct = await t.fake.api.request('/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-api-key-000000000000' },
      body: JSON.stringify({ input: 'x', session_id: 'cron_abc' }),
    });
    expect(direct.status).toBe(409);
    const other = await t.request('POST', '/x/i/fake/external/cron_abc/continue', { key: 'cle-suite-1', workspace: 'pro' });
    expect(other.status).toBe(400);
    expect(other.json.code).toBe('other_profile');
    const res = await t.request('POST', '/x/i/fake/external/cron_abc/continue', { key: 'cle-suite-1', workspace: 'dev' });
    expect(res.status).toBe(201);
    expect(res.json.session).toMatchObject({ title: 'Rapport du matin', workspace: 'dev', copiedFrom: 'cron_abc' });
    const base = `/x/sessions/fake/${res.json.session.id}`;
    expect((await t.request('GET', `${base}/messages`)).json.messages.map((m: any) => m.content)).toEqual(['Fais le rapport', 'Voici le rapport']);
    await sendAndWait(t, base, 'Ajoute les marges');
    expect((await t.request('POST', '/x/i/fake/external/inconnue/continue', { key: 'cle-suite-2', workspace: 'dev' })).status).toBe(404);
  });

  it('exports in Markdown, HTML and JSON, and imports the JSON safely', async () => {
    const { t, base, s } = await setup();
    await sendAndWait(t, base, 'Bonjour <b>');
    await t.request('PATCH', base, { title: 'Été 2026' });
    const md = await t.raw('GET', `${base}/export?format=md`);
    expect(md.status).toBe(200);
    expect(md.headers.get('content-disposition')).toContain("filename*=UTF-8''%C3%89t%C3%A9%202026.md");
    expect(await md.text()).toContain('## Vous');
    const html = await t.raw('GET', `${base}/export?format=html`);
    expect(await html.text()).toContain('Bonjour &lt;b&gt;');
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    const json = await t.raw('GET', `${base}/export?format=json`);
    const file = await json.json();
    expect(file.id).toBe(s.id);
    expect((await t.request('GET', `${base}/export?format=pdf`)).status).toBe(400);

    const imp = await t.request('POST', '/x/workspaces/dev/sessions/import', { key: 'cle-import-1', file });
    expect(imp.status).toBe(201);
    expect(imp.json.session.copiedFrom).toBe('import:cle-import-1');
    const body = t.fake.requests.filter((r) => r.path === '/api/sessions/import').at(-1)!.body as any;
    expect(body.sessions[0]).not.toHaveProperty('system_prompt');
    expect(body.sessions[0].messages.every((m: any) => m.role === 'user' || m.role === 'assistant')).toBe(true);
    const twice = await t.request('POST', '/x/workspaces/dev/sessions/import', { key: 'cle-import-1', file });
    expect(twice.status).toBe(200);
    expect(twice.json.session.id).toBe(imp.json.session.id);
    // {sessions: [one]} accepted, several refused, anything else refused
    expect((await t.request('POST', '/x/workspaces/dev/sessions/import', { key: 'cle-import-2', file: { sessions: [file] } })).status).toBe(201);
    expect((await t.request('POST', '/x/workspaces/dev/sessions/import', { key: 'cle-import-3', file: { sessions: [file, file] } })).status).toBe(400);
    expect((await t.request('POST', '/x/workspaces/dev/sessions/import', { key: 'cle-import-4', file: { nope: 1 } })).status).toBe(400);
  });

  it('refuses an import file over 10 MB and an empty export', async () => {
    const { t, base } = await setup();
    const big = await t.rawRequest('POST', '/x/workspaces/dev/sessions/import', {
      body: JSON.stringify({ key: 'cle-gros-01', file: { messages: [{ role: 'user', content: 'x'.repeat(10 * 1024 * 1024) }] } }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(big.status).toBe(413);
    const empty = await t.request('GET', `${base}/export?format=md`);
    expect(empty.status).toBe(404);
    expect(empty.json.code).toBe('empty');
  });

  it('filters sessions by source, CLI reading local and cli', async () => {
    const { t } = await setup();
    for (const [id, source] of [['loc_1', 'local'], ['cli_1', 'cli'], ['tg_1', 'telegram'], ['kb_1', 'kanban']]) {
      await t.fake.api.request('/_fake/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, source }) });
    }
    const ids = async (source: string) => (await t.request('GET', `/x/i/fake/sessions/recent?source=${source}`)).json.sessions.map((s: any) => s.id).sort();
    expect(await ids('cli')).toEqual(['cli_1', 'loc_1']);
    expect(await ids('kanban')).toEqual(['kb_1']);
    expect((await t.request('GET', '/x/i/fake/sessions/recent?source=bidon')).status).toBe(400);
  });
});
