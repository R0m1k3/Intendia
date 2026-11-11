import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configVersions } from '../src/db/schema.js';
import { underPath } from '../src/kanban/service.js';
import { frame, unframe } from '../src/workspaces/framing.js';
import { testApp } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;
const K = '/x/i/fake/kanban';
const kanbanCalls = (t: T) => t.fake.requests.filter((r) => r.path.startsWith('/api/plugins/kanban/'));
const last = (t: T, method: string, path: string) => t.fake.requests.filter((r) => r.method === method && r.path === path).at(-1);

async function task(t: T, body: Record<string, unknown>, board = 'default') {
  const res = await t.request('POST', `${K}/tasks?board=${board}`, body);
  expect(res.status).toBe(201);
  return res.json.task;
}

describe('kanban board', () => {
  it('orders columns like the workflow and leaves archived boards out', async () => {
    const t = await testApp();
    await task(t, { title: 'Une', start: 'ready' });
    const b = (await t.request('GET', `${K}/board?board=default`)).json;
    expect(b.columns.map((c: any) => c.key)).toEqual(['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done']);
    expect(b.columns.find((c: any) => c.key === 'ready').tasks[0]).toMatchObject({ title: 'Une', status: 'ready', workspace: null });
    t.fake.kanban.boards.get('default')!.archived = false;
    expect((await t.request('POST', `${K}/boards`, { slug: 'vieux', name: 'Vieux' })).status).toBe(201);
    t.fake.kanban.boards.get('vieux')!.archived = true;
    expect((await t.request('GET', `${K}/boards`)).json.boards.map((x: any) => x.slug)).toEqual(['default']);
  });

  it('refuses a board slug that exists (409) and invalid parameters without calling Hermes', async () => {
    const t = await testApp();
    const dup = await t.request('POST', `${K}/boards`, { slug: 'default' });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe('board_exists');
    const before = t.fake.requests.length;
    expect((await t.request('GET', `${K}/board`)).status).toBe(400);
    expect((await t.request('GET', `${K}/board?board=Pas%20bon`)).status).toBe(400);
    expect((await t.request('GET', `${K}/tasks/t_../x?board=default`)).status).toBe(404);
    expect((await t.request('GET', `${K}/tasks/zz?board=default`)).status).toBe(400);
    expect((await t.request('POST', `${K}/workers/x1/stop?board=default`)).status).toBe(400);
    expect((await t.request('GET', `${K}/attachments/abc?board=default`)).status).toBe(400);
    expect(t.fake.requests.length).toBe(before);
  });

  it('never sends ?profile= and always names the board', async () => {
    const t = await testApp();
    const start = t.fake.requests.length; // compatibility probes read without a board
    const a = await task(t, { title: 'Profil', assignee: 'default' });
    await t.request('GET', `${K}/tasks/${a.id}?board=default`);
    await t.request('PATCH', `${K}/tasks/${a.id}?board=default`, { priority: 2 });
    await t.request('POST', `${K}/dispatch?board=default&dry_run=1`);
    const calls = kanbanCalls(t).filter((r) => t.fake.requests.indexOf(r) >= start);
    expect(calls.every((r) => !('profile' in r.query))).toBe(true);
    const boardScoped = calls.filter((r) => !/\/(boards|workflow|orchestration|assignees|profiles)$/.test(r.path));
    expect(boardScoped.length).toBeGreaterThan(3);
    expect(boardScoped.every((r) => r.query.board === 'default')).toBe(true);
  });
});

describe('kanban tasks', () => {
  it('creates in scheduled by default (ready without agent, parked, then assigned), ready or triage on request, never todo', async () => {
    const t = await testApp();
    const a = await task(t, { title: 'Par défaut', assignee: 'default' });
    expect(a.status).toBe('scheduled');
    expect(a.assignee).toBe('default');
    const post = last(t, 'POST', '/api/plugins/kanban/tasks')!.body as Record<string, unknown>;
    expect(post).toMatchObject({ title: 'Par défaut', triage: false });
    expect(post.assignee).toBeUndefined();
    const patches = t.fake.requests.filter((r) => r.method === 'PATCH').map((r) => r.body);
    expect(patches).toEqual([{ status: 'scheduled' }, { assignee: 'default' }]);
    const r = await task(t, { title: 'Prête', start: 'ready', assignee: 'default' });
    expect(r.status).toBe('ready');
    expect(last(t, 'POST', '/api/plugins/kanban/tasks')!.body).toMatchObject({ triage: false, assignee: 'default' });
    expect((await task(t, { title: 'Tri', start: 'triage' })).status).toBe('triage');
    expect(last(t, 'POST', '/api/plugins/kanban/tasks')!.body).toMatchObject({ triage: true });
    expect((await t.request('POST', `${K}/tasks?board=default`, { title: 'Repos', start: 'todo' })).status).toBe(400);
  });

  it('follows Hermes on dependencies: a linked child waits in todo, then is promoted when its parent is done', async () => {
    const t = await testApp();
    const p = await task(t, { title: 'Parent', start: 'ready' });
    const c = await task(t, { title: 'Enfant', start: 'ready' });
    expect((await t.request('POST', `${K}/links?board=default`, { parent: p.id, child: c.id })).status).toBe(200);
    const st = async (id: string) => (await t.request('GET', `${K}/tasks/${id}?board=default`)).json.task.status;
    expect(await st(c.id)).toBe('todo');
    await t.request('PATCH', `${K}/tasks/${p.id}?board=default`, { status: 'done' });
    expect(await st(c.id)).toBe('ready');
  });

  it('refuses a title over 200 characters', async () => {
    const t = await testApp();
    expect((await t.request('POST', `${K}/tasks?board=default`, { title: 'x'.repeat(201) })).status).toBe(400);
    expect(t.fake.requests.some((r) => r.method === 'POST' && r.path === '/api/plugins/kanban/tasks')).toBe(false);
  });

  it('sends only the allowed fields on update', async () => {
    const t = await testApp();
    const a = await task(t, { title: 'Champs' });
    const res = await t.request('PATCH', `${K}/tasks/${a.id}?board=default`, { priority: 3, metadata: { x: 1 }, workspace_path: '/etc' });
    expect(res.status).toBe(200);
    expect(last(t, 'PATCH', `/api/plugins/kanban/tasks/${a.id}`)!.body).toEqual({ priority: 3 });
  });

  it('frames a task attached to a workspace and hides the block when reading it', async () => {
    const t = await testApp({});
    expect((await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' })).status).toBe(201);
    const a = await task(t, { title: 'Rapport été', body: 'Fais le point.', workspace: 'dev' });
    const sent = last(t, 'POST', '/api/plugins/kanban/tasks')!.body as Record<string, string>;
    expect(sent.workspace_kind).toBe('dir');
    expect(sent.workspace_path).toMatch(new RegExp(`^${t.root}/dev/kanban/rapport-ete-[0-9a-f]{4}$`));
    const key = sent.workspace_path!.split('/').at(-1);
    expect(sent.body).toMatch(new RegExp(`^\\[Intendia\\] Workspace : Dev \\(dev\\) ; dossier : kanban/${key}\\n`));
    expect(sent.body!.endsWith('[/Intendia]\n\nFais le point.')).toBe(true);
    expect(a.workspace).toEqual({ slug: 'dev', name: 'Dev', folder: `kanban/${key}` });
    expect(a.body).toBe('Fais le point.');
    const d = (await t.request('GET', `${K}/tasks/${a.id}?board=default`)).json;
    expect(d.task.body).toBe('Fais le point.');
    // a new body keeps the block
    await t.request('PATCH', `${K}/tasks/${a.id}?board=default`, { body: 'Autre consigne.' });
    const patched = last(t, 'PATCH', `/api/plugins/kanban/tasks/${a.id}`)!.body as Record<string, string>;
    expect(patched.body!.startsWith('[Intendia] Workspace : Dev (dev)')).toBe(true);
    expect(patched.body!.endsWith('\n\nAutre consigne.')).toBe(true);
  });

  it('refuses a workspace of another instance', async () => {
    const t = await testApp();
    await t.services.workspaces.createWorkspace({ slug: 'autre', name: 'Autre', instanceId: 'fake' });
    // simulate another instance by renaming the workspace's instance in the store
    const ws = t.services.workspaces.getWorkspace('autre');
    const orig = t.services.workspaces.getWorkspace.bind(t.services.workspaces);
    t.services.workspaces.getWorkspace = (slug: string) => (slug === 'autre' ? { ...ws, instanceId: 'ailleurs' } : orig(slug));
    const res = await t.request('POST', `${K}/tasks?board=default`, { title: 'X', workspace: 'autre' });
    expect(res.status).toBe(400);
  });

  it('matches workspaces by path segments', () => {
    expect(underPath('/vol/a', '/vol/a/kanban/x')).toBe(true);
    expect(underPath('/vol/a/', '/vol/a')).toBe(true);
    expect(underPath('/vol/a', '/vol/ab/kanban/x')).toBe(false);
    expect(underPath('/vol/a', '/vol/a/../b')).toBe(false);
  });

  it('relays Hermes refusals of a move (400) with its text', async () => {
    const t = await testApp();
    const a = await task(t, { title: 'Bouge' });
    const res = await t.request('PATCH', `${K}/tasks/${a.id}?board=default`, { status: 'running' });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('Cannot set status');
  });

  it('comments as intendia, links and unlinks', async () => {
    const t = await testApp();
    const a = await task(t, { title: 'Parent' });
    const b = await task(t, { title: 'Enfant' });
    expect((await t.request('POST', `${K}/tasks/${a.id}/comments?board=default`, { body: 'Vu' })).status).toBe(200);
    expect(last(t, 'POST', `/api/plugins/kanban/tasks/${a.id}/comments`)!.body).toEqual({ body: 'Vu', author: 'intendia' });
    expect((await t.request('POST', `${K}/links?board=default`, { parent: a.id, child: b.id })).status).toBe(200);
    let d = (await t.request('GET', `${K}/tasks/${b.id}?board=default`)).json;
    expect(d.parents).toEqual([{ id: a.id, title: 'Parent', status: 'scheduled' }]);
    expect(d.comments).toEqual([]);
    expect((await t.request('DELETE', `${K}/links?board=default&parent=${a.id}&child=${b.id}`)).status).toBe(200);
    d = (await t.request('GET', `${K}/tasks/${b.id}?board=default`)).json;
    expect(d.parents).toEqual([]);
    expect((await t.request('GET', `${K}/tasks/${a.id}?board=default`)).json.comments).toMatchObject([{ author: 'intendia', body: 'Vu' }]);
  });

  it('reports a failed specify as 422 aux_failed', async () => {
    const t = await testApp();
    const a = await task(t, { title: 'Flou' });
    const res = await t.request('POST', `${K}/tasks/${a.id}/specify?board=default`);
    expect(res.status).toBe(422);
    expect(res.json.code).toBe('aux_failed');
    const ok = await task(t, { title: 'A preciser' });
    expect((await t.request('POST', `${K}/tasks/${ok.id}/specify?board=default`)).status).toBe(200);
  });

  it('dispatches: dry run, then for real, with max=8', async () => {
    const t = await testApp({ kanbanStepMs: 10_000 });
    const a = await task(t, { title: 'Go', assignee: 'default', start: 'ready' });
    await task(t, { title: 'Personne', start: 'ready' });
    const dry = (await t.request('POST', `${K}/dispatch?board=default&dry_run=1`)).json;
    expect(dry).toEqual({ spawned: [{ taskId: a.id, assignee: 'default' }], skippedUnassigned: [expect.any(String)], dryRun: true });
    expect(last(t, 'POST', '/api/plugins/kanban/dispatch')!.query).toEqual({ board: 'default', dry_run: 'true', max: '8' });
    expect((await t.request('GET', `${K}/tasks/${a.id}?board=default`)).json.task.status).toBe('ready');
    await t.request('POST', `${K}/dispatch?board=default`);
    expect(last(t, 'POST', '/api/plugins/kanban/dispatch')!.query.dry_run).toBe('false');
    expect((await t.request('GET', `${K}/tasks/${a.id}?board=default`)).json.task.status).toBe('running');
  });

  it('shows the last 200 log lines, masked', async () => {
    const t = await testApp({ kanbanStepMs: 10_000 });
    const a = await task(t, { title: 'Log', assignee: 'default', start: 'ready' });
    await t.request('POST', `${K}/dispatch?board=default`);
    const log = (await t.request('GET', `${K}/tasks/${a.id}/log?board=default`)).json;
    expect(log.content.split('\n')).toHaveLength(200);
    expect(log.truncated).toBe(true);
    expect(log.content).not.toContain('sk-test-log');
    expect(log.content).toContain('«secret:');
  });
});

describe('kanban attachments', () => {
  it('relays a file as a download with the file CSP, and 404 when Hermes has none', async () => {
    const t = await testApp();
    const a = await task(t, { title: 'Pièce' });
    const id = t.fake.kanban.addAttachment('default', a.id, 'note.html', '<script>alert(1)</script>', 'text/html');
    expect((await t.request('GET', `${K}/tasks/${a.id}?board=default`)).json.attachments).toMatchObject([{ id, filename: 'note.html' }]);
    const res = await t.rawRequest('GET', `${K}/attachments/${id}?board=default`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="note.html"/);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('<script>alert(1)</script>');
    const missing = await t.rawRequest('GET', `${K}/attachments/999?board=default`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-disposition')).toBeNull();
  });
});

describe('kanban orchestration', () => {
  it('copies the config of the active profile before writing, and drops the copy when Hermes refuses', async () => {
    const t = await testApp();
    const o = (await t.request('GET', `${K}/orchestration`)).json;
    expect(o).toMatchObject({ autoDecompose: true, activeProfile: 'default', orchestratorProfile: null });
    const res = await t.request('PUT', `${K}/orchestration`, { auto_decompose: false, default_assignee: null });
    expect(res.status).toBe(200);
    expect(res.json.profile).toBe('default');
    expect(last(t, 'PUT', '/api/plugins/kanban/orchestration')!.body).toEqual({ auto_decompose: false, default_assignee: '' });
    const rows = t.db.select().from(configVersions).all();
    expect(rows.map((r) => r.profile)).toEqual(['default']);

    const t2 = await testApp({ breaks: { 'dash PUT /api/plugins/kanban/orchestration': { status: 400, body: { detail: 'unknown profile' } } } });
    const bad = await t2.request('PUT', `${K}/orchestration`, { orchestrator_profile: 'inconnu' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toContain('unknown profile');
    expect(t2.db.select().from(configVersions).all()).toEqual([]);
  });
});

describe('framing', () => {
  it('unframes crons and kanban blocks, each for its own area', () => {
    const block = (area: string) => [`[Intendia] Workspace : Dev (dev) ; dossier : ${area}/cle`, 'Dossier de travail : /w/dev/'];
    const k = frame('Texte', block('kanban'));
    expect(unframe(k, 'kanban')).toEqual({ prompt: 'Texte', slug: 'dev', folder: 'cle' });
    expect(unframe(k)).toEqual({ prompt: k, slug: null, folder: null });
    expect(unframe(frame('P', block('crons')))).toEqual({ prompt: 'P', slug: 'dev', folder: 'cle' });
  });

  it('creates the task folder through the dispatcher (under the fake files root)', async () => {
    const t = await testApp({ kanbanStepMs: 10_000 });
    await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
    const a = await task(t, { title: 'Dossier', workspace: 'dev', assignee: 'default', start: 'ready' });
    await t.request('POST', `${K}/dispatch?board=default`);
    expect(existsSync(join(t.root, 'dev', a.workspace.folder))).toBe(true);
  });
});
