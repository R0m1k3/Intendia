import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

const BASE = '/x/i/fake/crons';
const input = (over: Record<string, unknown> = {}) => ({
  name: 'Rapport du lundi', prompt: 'Fais le rapport.', schedule: '30 8 * * 1', deliver: 'local', skills: [], model: null, workspace: null, ...over,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hermesJob = (t: Awaited<ReturnType<typeof testApp>>, id: string) => t.fake.crons.jobs.get(id)!;

async function waitFinished(t: Awaited<ReturnType<typeof testApp>>, id: string, profile = 'default') {
  for (let i = 0; i < 200; i++) {
    const c = (await t.request('GET', `${BASE}/${id}?profile=${profile}`)).json.cron;
    if (c.lastRunAt) return c;
    await sleep(5);
  }
  throw new Error('cron run did not finish');
}

describe('crons', () => {
  it('lists an empty instance, creates a cron and hides internal fields', async () => {
    const t = await testApp();
    expect((await t.request('GET', BASE)).json).toEqual({ crons: [] });
    const res = await t.request('POST', BASE, input());
    expect(res.status).toBe(201);
    const cron = res.json.cron;
    expect(cron).toMatchObject({
      instanceId: 'fake', profile: 'default', name: 'Rapport du lundi', prompt: 'Fais le rapport.', workspace: null,
      schedule: { kind: 'cron', expr: '30 8 * * 1' }, enabled: true, deliver: 'local', skills: [], model: null,
    });
    const list = (await t.request('GET', BASE)).json.crons;
    expect(list).toHaveLength(1);
    const raw = JSON.stringify(list);
    for (const k of ['hermes_home', 'script', 'monitor_url', 'origin', 'workdir']) expect(raw).not.toContain(k);
    // never send provider (phase 2 rule)
    expect(t.fake.requests.find((r) => r.method === 'POST')?.body).not.toHaveProperty('provider');
  });

  it('a cron attached to a workspace gets the framing block, workdir and a folder key', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'ventes', name: 'Ventes', instanceId: 'fake' });
    const cron = (await t.request('POST', BASE, input({ workspace: 'ventes' }))).json.cron;
    expect(cron.prompt).toBe('Fais le rapport.');
    expect(cron.workspace).toEqual({ slug: 'ventes', name: 'Ventes', folder: 'rapport-du-lundi', missing: false });
    const job = hermesJob(t, cron.id);
    expect(job.prompt).toMatch(/^\[Intendia\] Workspace : Ventes \(ventes\) ; dossier : crons\/rapport-du-lundi\n/);
    expect(job.prompt).toContain(`Range chaque fichier que tu produis dans ${t.mount}/ventes/crons/rapport-du-lundi/.`);
    expect(job.prompt).toContain(`Lis ${t.mount}/ventes/AGENTS.md avant de commencer.`);
    expect(job.prompt).toContain('share_file');
    expect(job.workdir).toBe(`${t.mount}/ventes`);

    // same name: -2; a folder already on disk is skipped too
    mkdirSync(join(t.mount, 'ventes', 'crons', 'rapport-du-lundi-3'), { recursive: true });
    expect((await t.request('POST', BASE, input({ workspace: 'ventes' }))).json.cron.workspace.folder).toBe('rapport-du-lundi-2');
    expect((await t.request('POST', BASE, input({ workspace: 'ventes' }))).json.cron.workspace.folder).toBe('rapport-du-lundi-4');
  });

  it('editing keeps the folder key, detaching clears workdir and the block', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'ventes', name: 'Ventes', instanceId: 'fake' });
    const { id } = (await t.request('POST', BASE, input({ workspace: 'ventes' }))).json.cron;
    const renamed = (await t.request('PUT', `${BASE}/${id}?profile=default`, input({ name: 'Autre nom', prompt: 'Nouveau prompt', workspace: 'ventes', schedule: undefined }))).json.cron;
    expect(renamed).toMatchObject({ name: 'Autre nom', prompt: 'Nouveau prompt', workspace: { folder: 'rapport-du-lundi' }, schedule: { expr: '30 8 * * 1' } });
    expect(String(hermesJob(t, id).prompt).match(/\[Intendia\]/g)).toHaveLength(1);
    const put = t.fake.requests.findLast((r) => r.method === 'PUT');
    expect(put?.body).toHaveProperty('updates');
    expect((put?.body as { updates: object }).updates).not.toHaveProperty('schedule');

    const detached = (await t.request('PUT', `${BASE}/${id}?profile=default`, input({ prompt: 'Seul' }))).json.cron;
    expect(detached).toMatchObject({ workspace: null, prompt: 'Seul' });
    expect(hermesJob(t, id).prompt).toBe('Seul');
    expect(hermesJob(t, id).workdir).toBeNull();
  });

  it('moving to another workspace keeps the key only if it is free there', async () => {
    const t = await testApp();
    for (const slug of ['ventes', 'achats', 'stock']) await t.request('POST', '/x/workspaces', { slug, name: slug, instanceId: 'fake' });
    const { id } = (await t.request('POST', BASE, input({ workspace: 'ventes' }))).json.cron;
    // a folder left in achats by a deleted cron must not be reused
    mkdirSync(join(t.mount, 'achats', 'crons', 'rapport-du-lundi'), { recursive: true });
    const moved = (await t.request('PUT', `${BASE}/${id}?profile=default`, input({ workspace: 'achats' }))).json.cron;
    expect(moved.workspace).toMatchObject({ slug: 'achats', folder: 'rapport-du-lundi-2' });
    expect(hermesJob(t, id).prompt).toContain(`${t.mount}/achats/crons/rapport-du-lundi-2/`);
    // free in stock: the key moves with the cron (its own former key is not counted as taken)
    const again = (await t.request('PUT', `${BASE}/${id}?profile=default`, input({ workspace: 'stock' }))).json.cron;
    expect(again.workspace).toMatchObject({ slug: 'stock', folder: 'rapport-du-lundi-2' });
  });

  it('shows a deleted workspace as missing', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'ventes', name: 'Ventes', instanceId: 'fake' });
    const { id } = (await t.request('POST', BASE, input({ workspace: 'ventes' }))).json.cron;
    hermesJob(t, id).prompt = String(hermesJob(t, id).prompt).replace('(ventes)', '(disparu)');
    expect((await t.request('GET', `${BASE}/${id}?profile=default`)).json.cron.workspace).toMatchObject({ slug: 'disparu', missing: true, name: null });
  });

  it('a workspace on a profile creates the cron there; another profile is refused on edit', async () => {
    const t = await testApp({ profileKeys: { recherche: 'key-recherche-0000000000' } });
    await t.request('POST', '/x/workspaces', { slug: 'labo', name: 'Labo', instanceId: 'fake', profile: 'recherche' });
    await t.request('POST', '/x/workspaces', { slug: 'ventes', name: 'Ventes', instanceId: 'fake' });
    const cron = (await t.request('POST', BASE, input({ workspace: 'labo' }))).json.cron;
    expect(cron.profile).toBe('recherche');
    const plain = (await t.request('POST', BASE, input())).json.cron;
    const res = await t.request('PUT', `${BASE}/${plain.id}?profile=default`, input({ workspace: 'labo' }));
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('profil recherche');
    // wrong profile for the job: Hermes answers 404
    expect((await t.request('POST', `${BASE}/${cron.id}/pause?profile=default`)).status).toBe(404);
    expect((await t.request('POST', `${BASE}/${cron.id}/pause?profile=recherche`)).json.cron.enabled).toBe(false);
  });

  it('refuses a workspace of another instance', async () => {
    const t = await testApp();
    await t.request('POST', '/x/workspaces', { slug: 'ventes', name: 'Ventes', instanceId: 'fake' });
    t.db.$client.prepare("UPDATE workspaces SET instance_id = 'autre' WHERE slug = 'ventes'").run();
    expect((await t.request('POST', BASE, input({ workspace: 'ventes' }))).status).toBe(400);
  });

  it('pause, resume, trigger until the run ends, then history and delete', async () => {
    const t = await testApp();
    const { id } = (await t.request('POST', BASE, input())).json.cron;
    expect((await t.request('POST', `${BASE}/${id}/pause?profile=default`)).json.cron).toMatchObject({ enabled: false, state: 'paused' });
    expect((await t.request('POST', `${BASE}/${id}/resume?profile=default`)).json.cron).toMatchObject({ enabled: true, state: 'scheduled' });
    const before = (await t.request('POST', `${BASE}/${id}/trigger?profile=default`)).json.cron;
    expect(before.lastRunAt).toBeNull();
    const after = await waitFinished(t, id);
    expect(after).toMatchObject({ lastStatus: 'ok', lastError: null });
    const runs = (await t.request('GET', `${BASE}/${id}/runs?profile=default`)).json.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ messageCount: 2, endReason: 'completed' });
    expect(runs[0].endedAt).not.toBeNull();
    // the run is a Hermes session
    const msgs = await t.request('GET', `/x/i/fake/external/${runs[0].id}/messages?profile=default`);
    expect(msgs.status).toBe(200);
    expect(JSON.stringify(msgs.json)).toContain('Cron exécuté.');
    expect((await t.request('DELETE', `${BASE}/${id}?profile=default`)).status).toBe(204);
    expect((await t.request('GET', `${BASE}/${id}?profile=default`)).status).toBe(404);
  });

  it('a blocked run shows its reason; a long run can be cancelled', async () => {
    const t = await testApp();
    const blocked = (await t.request('POST', BASE, input({ prompt: 'bloque' }))).json.cron;
    await t.request('POST', `${BASE}/${blocked.id}/trigger?profile=default`);
    expect(await waitFinished(t, blocked.id)).toMatchObject({ lastStatus: 'blocked_config', lastError: expect.stringContaining('provider credential missing') });

    const long = (await t.request('POST', BASE, input({ prompt: 'tâche long' }))).json.cron;
    expect((await t.request('POST', `${BASE}/${long.id}/cancel?profile=default`)).json).toMatchObject({ cancelled: false });
    await t.request('POST', `${BASE}/${long.id}/trigger?profile=default`);
    expect((await t.request('POST', `${BASE}/${long.id}/cancel?profile=default`)).json).toEqual({ cancelled: true, detail: 'Cancelled.' });
    expect((await t.request('GET', `${BASE}/${long.id}?profile=default`)).json.cron.lastStatus).toBe('cancelled');
  });

  it('an invalid schedule comes back as a field error with Hermes text', async () => {
    const t = await testApp();
    const res = await t.request('POST', BASE, input({ schedule: 'n importe quoi' }));
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'Planning invalide', field: 'schedule', detail: expect.stringContaining("Invalid schedule 'n importe quoi'") });
  });

  it('validates ids, profiles and bodies', async () => {
    const t = await testApp();
    expect((await t.request('GET', `${BASE}/abc`)).status).toBe(400);
    expect((await t.request('GET', `${BASE}/abc?profile=../x`)).status).toBe(400);
    expect((await t.request('GET', `${BASE}/a%2Fb?profile=default`)).status).toBe(400);
    expect((await t.request('GET', `${BASE}/aaaaaaaaaaaa?profile=nope`)).status).toBe(404);
    expect((await t.request('POST', BASE, input({ name: '' }))).status).toBe(400);
    expect((await t.request('POST', BASE, input({ skills: ['a b'] }))).status).toBe(400);
    expect((await t.request('GET', '/x/i/inconnue/crons')).status).toBe(404);
  });

  it('lists the delivery targets', async () => {
    const t = await testApp();
    expect((await t.request('GET', `${BASE}/targets`)).json.targets).toEqual([
      { id: 'local', name: 'Local (save only)' }, { id: 'bot-chat:default', name: 'Bot Chat (default)' },
    ]);
  });

  it('with the API server only: list and create work, history is 409, module readonly', async () => {
    const t = await testApp({ hide: { openapi: [
      'GET /api/cron/jobs', 'POST /api/cron/jobs', 'GET /api/cron/jobs/{job_id}', 'PUT /api/cron/jobs/{job_id}',
      'DELETE /api/cron/jobs/{job_id}', 'GET /api/cron/jobs/{job_id}/runs', 'POST /api/cron/jobs/{job_id}/pause',
      'POST /api/cron/jobs/{job_id}/resume', 'POST /api/cron/jobs/{job_id}/trigger', 'POST /api/cron/jobs/{job_id}/cancel',
      'GET /api/cron/delivery-targets',
    ] } });
    const report = t.compat.get('fake')!.modules.find((m) => m.id === 'crons')!;
    expect(report.state).toBe('readonly');
    const { id } = (await t.request('POST', BASE, input())).json.cron;
    expect((await t.request('GET', BASE)).json.crons).toHaveLength(1);
    const edited = await t.request('PUT', `${BASE}/${id}?profile=default`, input({ name: 'Via API' }));
    expect(edited.json.cron.name).toBe('Via API');
    expect(t.fake.requests.findLast((r) => r.method === 'PATCH')?.body).toMatchObject({ name: 'Via API' });
    expect((await t.request('GET', `${BASE}/${id}/runs?profile=default`)).status).toBe(409);
    expect((await t.request('POST', `${BASE}/${id}/trigger?profile=default`)).status).toBe(200);
  });

  it('upcoming: active crons sorted by next run, a broken instance left out', async () => {
    const t = await testApp();
    await t.request('POST', BASE, input({ name: 'Dans 2 h', schedule: 'every 2h' }));
    await t.request('POST', BASE, input({ name: 'Dans 30 min', schedule: 'every 30m' }));
    await t.request('POST', BASE, input({ name: 'En pause', schedule: 'every 10m', paused: true }));
    const up = (await t.request('GET', '/x/crons/upcoming')).json.upcoming;
    expect(up.map((u: { name: string }) => u.name)).toEqual(['Dans 30 min', 'Dans 2 h']);
    expect(up[0]).toMatchObject({ instanceId: 'fake', instanceLabel: 'Fake', profile: 'default' });

    const broken = await testApp({ breaks: { 'dash GET /api/cron/jobs': { status: 500 } } });
    expect((await broken.request('GET', '/x/crons/upcoming')).json).toEqual({ upcoming: [] });
  });
});
