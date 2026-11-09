import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSse, testApp, waitRun } from './helpers.js';

const DEV_KEY = 'dev-profile-key-0000000';

async function session(opts: Parameters<typeof testApp>[0] = {}, ws: Record<string, unknown> = {}) {
  const t = await testApp(opts);
  const created = await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake', model: 'opus', ...ws });
  expect(created.status).toBe(201);
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}

const runsPosted = (t: Awaited<ReturnType<typeof testApp>>) => t.fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/runs');

describe('sending a message', () => {
  it('sends session_id, the workspace model and the framing block', async () => {
    const { t, s, base } = await session({ instance: { agentMount: '/opt/data/workspace' } });
    writeFileSync(join(t.mount, 'dev', 'AGENTS.md'), `Réponds en français.\n${'é'.repeat(3000)}`);
    const res = await t.request('POST', `${base}/runs`, { input: 'Bonjour' });
    expect(res.status).toBe(200);
    expect(res.json.runId).toMatch(/^run_/);
    const body = runsPosted(t)[0]!.body as Record<string, string>;
    expect(body).toMatchObject({ input: 'Bonjour', session_id: s.id, model: 'opus' });
    expect(body.instructions).toContain('[Intendia] Workspace : Dev (dev)');
    expect(body.instructions).toContain('Dossier de travail : /opt/data/workspace/dev/');
    expect(body.instructions).toContain(`Range chaque fichier que tu produis dans /opt/data/workspace/dev/sessions/${s.id}/.`);
    expect(body.instructions).toContain('Réponds en français.');
    expect(body.instructions).toContain("Si l'outil share_file est disponible, appelle-le pour chaque fichier livré avec son chemin complet et donne le lien renvoyé.\nConsignes du projet (");
    expect(body.instructions).toContain('(suite tronquée : lis /opt/data/workspace/dev/AGENTS.md en entier avant de commencer)');
    expect(body.instructions).not.toContain('�');
    const after = (await t.request('GET', base)).json.session;
    expect(after.lastRunId).toBe(res.json.runId);
    expect(after.lastActiveAt).toBeGreaterThan(0);
  });

  it('refuses a second message while a run is going, accepts it once finished or forgotten', async () => {
    const { t, base } = await session();
    const first = await t.request('POST', `${base}/runs`, { input: 'approval svp' });
    expect((await t.request('POST', `${base}/runs`, { input: 'encore' })).status).toBe(409);
    while ((await t.request('GET', `${base}/runs/${first.json.runId}`)).json.status !== 'waiting_for_approval') await new Promise((r) => setTimeout(r, 5));
    expect((await t.request('POST', `${base}/runs/${first.json.runId}/approval`, { choice: 'once', requestId: 'apr_1' })).status).toBe(200);
    expect(await waitRun(t, base, first.json.runId)).toBe('completed');
    expect((await t.request('POST', `${base}/runs`, { input: 'encore' })).status).toBe(200);

    // Hermes restarted and forgot the run: sending is allowed
    t.fake.sim.runs.clear();
    expect((await t.request('GET', `${base}/runs/${(await t.request('GET', base)).json.session.lastRunId}`)).json.status).toBe('unknown');
    expect((await t.request('POST', `${base}/runs`, { input: 'après redémarrage' })).status).toBe(200);
  });

  it('two concurrent sends to the same session start one run only', async () => {
    const { t, base } = await session();
    const [a, b] = await Promise.all([
      t.request('POST', `${base}/runs`, { input: 'premier' }),
      t.request('POST', `${base}/runs`, { input: 'second' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(runsPosted(t)).toHaveLength(1);
  });

  it('goes through /p/<profile>/ with the profile key', async () => {
    const { t, base } = await session({ profileKeys: { dev: DEV_KEY } }, { profile: 'dev' });
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    await readSse(await t.raw('GET', `${base}/runs/${run}/events`), 200);
    await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'deny', requestId: 'apr_1' });
    await t.request('POST', `${base}/runs/${run}/stop`, {});
    const hits = t.fake.requests.filter((r) => r.path.startsWith('/v1/runs'));
    expect(hits.length).toBeGreaterThanOrEqual(4);
    for (const h of hits) {
      expect(h.profile).toBe('dev');
      expect(h.authorization).toBe(`Bearer ${DEV_KEY}`);
    }
  });

  it('answers 422 when the profile key was removed after creation', async () => {
    const { t, base } = await session({ profileKeys: { dev: DEV_KEY } }, { profile: 'dev' });
    delete t.store.get('fake')!.profileKeys.dev;
    expect((await t.request('POST', `${base}/runs`, { input: 'x' })).status).toBe(422);
  });

  it('answers 504 when the instance is unreachable', async () => {
    const { t, base } = await session();
    t.store.get('fake')!.api = 'http://unreachable';
    expect((await t.request('POST', `${base}/runs`, { input: 'x' })).status).toBe(504);
  });

  it('answers 409 with reasons when createRun is missing, and ignores a missing steer', async () => {
    const broken = await session({ hide: { capabilities: ['runs'] } });
    const res = await broken.t.request('POST', `${broken.base}/runs`, { input: 'x' });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ module: 'chat', op: 'createRun' });
    const noSteer = await session({ hide: { capabilities: ['run_steer'] } });
    expect((await noSteer.t.request('POST', `${noSteer.base}/runs`, { input: 'x' })).status).toBe(200);
  });
});

describe('run stream', () => {
  it('relays Hermes events in order, then resumes after Last-Event-ID', async () => {
    const { t, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, base, run);
    const all = await readSse(await t.raw('GET', `${base}/runs/${run}/events`));
    expect(all.map((e) => e.data.event)).toEqual(['run.started', 'message.delta', 'message.delta', 'tool.started', 'tool.completed', 'run.completed']);
    expect(all.map((e) => e.id)).toEqual(['0', '1', '2', '3', '4', '5']);
    const rest = await readSse(await t.raw('GET', `${base}/runs/${run}/events`, undefined, { 'Last-Event-ID': '2' }));
    expect(rest.map((e) => e.data.seq)).toEqual([3, 4, 5]);
    expect(t.fake.requests.at(-1)?.headers['last-event-id']).toBe('2');
    expect(t.fake.requests.at(-1)?.headers.accept).toBe('text/event-stream');
  });

  it('passes replay.truncated through when Hermes forgot the start', async () => {
    const { t, base } = await session({ retainFrom: 3 });
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, base, run);
    const ev = await readSse(await t.raw('GET', `${base}/runs/${run}/events`));
    expect(ev[0]!.data).toMatchObject({ event: 'replay.truncated', oldest_retained_seq: 3 });
    expect(ev.slice(1).map((e) => e.data.seq)).toEqual([3, 4, 5]);
  });

  it('sends one intendia.error frame when Hermes does not know the run', async () => {
    const { t, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, base, run);
    t.fake.sim.runs.clear();
    const ev = await readSse(await t.raw('GET', `${base}/runs/${run}/events`));
    expect(ev).toEqual([{ id: null, data: { event: 'intendia.error', status: 404, message: 'Run introuvable chez Hermes' } }]);
  });

  it('only serves the session last run, with valid ids', async () => {
    const { t, base } = await session();
    expect((await t.request('GET', `${base}/runs/run_other0001`)).status).toBe(404);
    expect((await t.request('GET', `${base}/runs/not-a-run`)).status).toBe(400);
    expect((await t.request('GET', '/x/sessions/fake/a%2Fb/messages')).status).toBe(400);
  });

  it('forwards approvals with choice and request_id', async () => {
    const { t, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    const ev = await readSse(await t.raw('GET', `${base}/runs/${run}/events`), 200);
    expect(ev.at(-1)?.data).toMatchObject({ event: 'approval.request', choices: ['once', 'session', 'always', 'deny'], request_id: 'apr_1' });
    expect((await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'session', requestId: 'apr_1' })).status).toBe(200);
    expect(t.fake.requests.find((r) => r.path.endsWith('/approval'))?.body).toEqual({ choice: 'session', request_id: 'apr_1' });
    expect((await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'peut-être' })).status).toBe(400);
  });
});

describe('history', () => {
  it('is empty before the first message, then oldest first without session_meta', async () => {
    const { t, base } = await session();
    expect((await t.request('GET', `${base}/messages`)).json.messages).toEqual([]);
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    await waitRun(t, base, run);
    const msgs = (await t.request('GET', `${base}/messages`)).json.messages;
    expect(msgs.map((m: any) => m.role)).toEqual(['user', 'tool', 'assistant']);
    expect(msgs[0]).toMatchObject({ content: 'Bonjour', toolName: null, toolCalls: [] });
    expect(msgs[1].toolName).toBe('terminal');
    expect(msgs.map((m: any) => m.id)).toEqual([...msgs.map((m: any) => m.id)].sort((a: number, b: number) => a - b));
  });
});
