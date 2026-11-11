import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { COST_SETTLE_MS } from '../src/chat/run-stats.js';
import { readSse, testApp, waitRun } from './helpers.js';

const DEV_KEY = 'dev-profile-key-0000000';

async function session(opts: Parameters<typeof testApp>[0] = {}, ws: Record<string, unknown> = {}) {
  const t = await testApp(opts);
  const created = await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake', ...ws });
  expect(created.status).toBe(201);
  const s = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
  return { t, s, base: `/x/sessions/fake/${s.id}` };
}

const runsPosted = (t: Awaited<ReturnType<typeof testApp>>) => t.fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/runs');

describe('sending a message', () => {
  it('sends session_id and the framing block, no model nor model_options while on Auto', async () => {
    const { t, s, base } = await session({});
    writeFileSync(join(t.root, 'dev', 'AGENTS.md'), `Réponds en français.\n${'é'.repeat(3000)}`);
    const res = await t.request('POST', `${base}/runs`, { input: 'Bonjour' });
    expect(res.status).toBe(200);
    expect(res.json.runId).toMatch(/^run_/);
    const body = runsPosted(t)[0]!.body as Record<string, string>;
    expect(body).toMatchObject({ input: 'Bonjour', session_id: s.id });
    expect(body).not.toHaveProperty('model');
    expect(body).not.toHaveProperty('model_options');
    expect(body.instructions).toContain('[Intendia] Workspace : Dev (dev)');
    expect(body.instructions).toContain(`Dossier de travail : ${t.root}/dev/`);
    expect(body.instructions).toContain(`Range chaque fichier que tu produis dans ${t.root}/dev/sessions/${s.id}/.`);
    expect(body.instructions).toContain('Réponds en français.');
    expect(body.instructions).toContain("Si l'outil share_file est disponible, appelle-le pour chaque fichier livré avec son chemin complet et donne le lien renvoyé.\nConsignes du projet (");
    expect(body.instructions).toContain(`(suite tronquée : lis ${t.root}/dev/AGENTS.md en entier avant de commencer)`);
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

  it('answers approvals in the format of Hermes 0.23 (gateway session authority)', async () => {
    const { t, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    const ev = await readSse(await t.raw('GET', `${base}/runs/${run}/events`), 200);
    expect(ev.at(-1)?.data).toMatchObject({ event: 'approval.request', prompt_id: 'apr_1', execution_generation: 1 });
    // no id from the page: the only pending approval of the run status is answered
    expect((await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'session' })).status).toBe(200);
    expect(t.fake.requests.find((r) => r.path.endsWith('/approval'))?.body).toEqual({ request_id: 'apr_1', execution_generation: 1, choice: 'session' });
    await waitRun(t, base, run);
    const again = await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'once', requestId: 'apr_1' });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('no_pending');
    expect((await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'peut-être' })).status).toBe(400);
  });

  it('forwards approvals with choice and request_id to an API server without the session authority', async () => {
    const { t, base } = await session({ controls: 'legacy' });
    const run = (await t.request('POST', `${base}/runs`, { input: 'approval' })).json.runId;
    const ev = await readSse(await t.raw('GET', `${base}/runs/${run}/events`), 200);
    expect(ev.at(-1)?.data).toMatchObject({ event: 'approval.request', choices: ['once', 'session', 'always', 'deny'], request_id: 'apr_1' });
    expect((await t.request('POST', `${base}/runs/${run}/approval`, { choice: 'session', requestId: 'apr_1' })).status).toBe(200);
    expect(t.fake.requests.find((r) => r.path.endsWith('/approval'))?.body).toEqual({ choice: 'session', request_id: 'apr_1' });
  });

  it('answers a question of the agent with the exact body of Hermes 0.23', async () => {
    const { t, base } = await session();
    const run = (await t.request('POST', `${base}/runs`, { input: 'question multi' })).json.runId;
    const ev = await readSse(await t.raw('GET', `${base}/runs/${run}/events`), 200);
    expect(ev.at(-1)?.data).toMatchObject({ event: 'clarify.request', prompt_id: 'clr_1', multi_select: true });
    expect((await t.request('POST', `${base}/runs/${run}/clarify`, { answer: '' })).status).toBe(400);
    const answer = JSON.stringify(['Frouard', 'Houdemont']);
    expect((await t.request('POST', `${base}/runs/${run}/clarify`, { answer, requestId: 'clr_1' })).status).toBe(200);
    expect(t.fake.requests.find((r) => r.path.endsWith('/clarify'))?.body).toEqual({ request_id: 'clr_1', execution_generation: 1, answer });
    await waitRun(t, base, run);
    const again = await t.request('POST', `${base}/runs/${run}/clarify`, { answer: 'Frouard' });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('no_pending');
  });

  it('says a question cannot be answered without the session authority', async () => {
    const { t, base } = await session({ controls: 'legacy' });
    const run = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    const res = await t.request('POST', `${base}/runs/${run}/clarify`, { answer: 'Frouard' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('clarify_unavailable');
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

describe('run options and consumption', () => {
  it('sends the session model and effort (model_options) only when chosen', async () => {
    const { t, base } = await session();
    await t.request('PATCH', base, { model: 'anthropic/claude-opus-4.6', effort: 'high' });
    const first = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    expect(runsPosted(t)[0]!.body).toMatchObject({ model: 'anthropic/claude-opus-4.6', model_options: { reasoning_effort: 'high' } });
    await waitRun(t, base, first);
    await t.request('PATCH', base, { effort: null });
    await t.request('POST', `${base}/runs`, { input: 'Encore' });
    const second = runsPosted(t)[1]!.body as Record<string, unknown>;
    expect(second.model).toBe('anthropic/claude-opus-4.6');
    expect(second).not.toHaveProperty('model_options');
  });

  it('sends the provider with a model picked in a group; a model alone clears it; new sessions take both', async () => {
    const { t, base } = await session();
    expect((await t.request('PATCH', base, { model: 'claude-haiku-4.5', provider: 'anthropic' })).json.session)
      .toMatchObject({ model: 'claude-haiku-4.5', modelProvider: 'anthropic' });
    const first = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    expect(runsPosted(t)[0]!.body).toMatchObject({ model: 'claude-haiku-4.5', provider: 'anthropic' });
    await waitRun(t, base, first);
    // a new session of the workspace starts from both
    const next = (await t.request('POST', '/x/workspaces/dev/sessions')).json.session;
    expect(next).toMatchObject({ model: 'claude-haiku-4.5', modelProvider: 'anthropic' });
    // a model alone (older client, old session) clears the provider: model sent alone
    expect((await t.request('PATCH', base, { model: 'openai/gpt-5.5' })).json.session.modelProvider).toBeNull();
    await t.request('POST', `${base}/runs`, { input: 'Encore' });
    const second = runsPosted(t)[1]!.body as Record<string, unknown>;
    expect(second.model).toBe('openai/gpt-5.5');
    expect(second).not.toHaveProperty('provider');
    // Auto clears both; a provider without a model is refused; custom:<name> keys are accepted
    expect((await t.request('PATCH', base, { model: null })).json.session).toMatchObject({ model: null, modelProvider: null });
    expect((await t.request('PATCH', base, { provider: 'anthropic' })).status).toBe(400);
    expect((await t.request('PATCH', base, { model: 'm', provider: 'bad provider' })).status).toBe(400);
    expect((await t.request('PATCH', base, { model: 'llama3:8b', provider: 'custom:local' })).json.session.modelProvider).toBe('custom:local');
  });

  it('records a row at send time, settles it when the messages are read, and returns it', async () => {
    const { t, base } = await session();
    await t.request('PATCH', base, { effort: 'low' });
    const runId = (await t.request('POST', `${base}/runs`, { input: 'Bonjour' })).json.runId;
    // wait for the fake run to end without going through GET runs/:id (which settles too)
    while (t.fake.sim.runs.get(runId)!.status !== 'completed') await new Promise((r) => setTimeout(r, 5));
    const res = (await t.request('GET', `${base}/messages`)).json;
    expect(res.runs).toHaveLength(1);
    expect(res.runs[0]).toMatchObject({
      runId, status: 'completed', requestedModel: null, requestedEffort: 'low', servedModel: 'fake/model-default',
      inputTokens: 12_000, outputTokens: 800, cacheReadTokens: 9_000, cacheWriteTokens: 500, costUsd: 0.0123,
    });
    expect(res.runs[0].endedAt).toBeGreaterThanOrEqual(res.runs[0].startedAt);
  });

  it('settles a row once when two reads race, costs each run by difference, freezes a settled previous at send', async () => {
    const { t, base } = await session();
    const a = (await t.request('POST', `${base}/runs`, { input: 'un' })).json.runId;
    while (t.fake.sim.runs.get(a)!.status !== 'completed') await new Promise((r) => setTimeout(r, 5));
    const [r1, r2] = await Promise.all([t.request('GET', `${base}/messages`), t.request('GET', `${base}/messages`)]);
    expect(r1.json.runs).toEqual(r2.json.runs);
    expect(r1.json.runs[0]).toMatchObject({ costUsd: 0.0123, costFinal: false, costRuns: 1 });
    // the next message comes after the settling delay: the previous cost is frozen on the current total
    const realNow = Date.now.bind(Date);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + COST_SETTLE_MS + 1_000);
    try {
      const b = (await t.request('POST', `${base}/runs`, { input: 'deux cher' })).json.runId;
      await waitRun(t, base, b);
      const runs = (await t.request('GET', `${base}/messages`)).json.runs;
      expect(runs.map((r: any) => [r.runId, r.costUsd, r.costRuns])).toEqual([[a, 0.0123, 1], [b, 0.0123, 1]]);
      expect(runs[0].costFinal).toBe(true);
      expect(runs[1]).toMatchObject({ inputTokens: 1_250_000, outputTokens: 5_200 });
      // the first row is frozen: a later change of the session total does not move it
      t.fake.sim.costs.set(t.fake.sim.runs.get(a)!.sessionId, 1);
      const again = (await t.request('GET', `${base}/messages`)).json.runs;
      expect(again[0].costUsd).toBe(0.0123);
      expect(again[1].costUsd).toBeCloseTo(1 - 0.0123, 6);
    } finally {
      clock.mockRestore();
    }
  });

  it('a message sent before Hermes costed the previous run: that cost becomes unknown, the new run covers both', async () => {
    const { t, base } = await session();
    const a = (await t.request('POST', `${base}/runs`, { input: 'un' })).json.runId;
    while (t.fake.sim.runs.get(a)!.status !== 'completed') await new Promise((r) => setTimeout(r, 5));
    const sid = t.fake.sim.runs.get(a)!.sessionId;
    // Hermes has not written the first run's cost yet
    t.fake.sim.costs.set(sid, 0);
    const b = (await t.request('POST', `${base}/runs`, { input: 'deux' })).json.runId;
    await waitRun(t, base, b);
    // both costs arrive later: 0.0123 each
    t.fake.sim.costs.set(sid, 0.0246);
    const runs = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(runs.map((r: any) => [r.runId, r.costUsd, r.costRuns, r.costFinal])).toEqual([[a, null, 1, true], [b, 0.0246, 2, false]]);
    // b is costed now: sending again freezes it on its own cost (no hand-over)
    const c2 = (await t.request('POST', `${base}/runs`, { input: 'trois' })).json.runId;
    await waitRun(t, base, c2);
    const r3 = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(r3.map((r: any) => [r.costUsd, r.costRuns])).toEqual([[null, 1], [0.0246, 2], [0.0123, 1]]);
    // c2 not costed yet when the next message goes out: handed over to it
    t.fake.sim.costs.set(sid, 0.0246);
    const c = (await t.request('POST', `${base}/runs`, { input: 'quatre lent' })).json.runId;
    // a refused send (run in progress) inserts nothing
    expect((await t.request('POST', `${base}/runs`, { input: 'cinq' })).status).toBe(409);
    // c (still running, not listed) took over from c2
    const after = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(after.map((r: any) => [r.runId, r.costUsd, r.costRuns, r.costFinal])).toEqual([[a, null, 1, true], [b, 0.0246, 2, true], [c2, null, 1, true]]);
  });

  it('failed runs have no tokens, forgotten runs become unknown, a changed live session gives no cost', async () => {
    const { t, base } = await session();
    const a = (await t.request('POST', `${base}/runs`, { input: 'panne' })).json.runId;
    expect(await waitRun(t, base, a)).toBe('failed');
    let runs = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(runs[0]).toMatchObject({ status: 'failed', servedModel: null, inputTokens: null, outputTokens: null, costUsd: 0 });

    const b = (await t.request('POST', `${base}/runs`, { input: 'lent' })).json.runId;
    t.fake.sim.runs.delete(b);
    runs = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(runs[1]).toMatchObject({ runId: b, status: 'unknown', inputTokens: null, costUsd: null });

    // compression during the run: the live session reported by /messages is another one
    const c = (await t.request('POST', `${base}/runs`, { input: 'trois' })).json.runId;
    while (t.fake.sim.runs.get(c)!.status !== 'completed') await new Promise((r) => setTimeout(r, 5));
    t.fake.sim.liveAlias.set(t.fake.sim.runs.get(c)!.sessionId, 'continuation-1');
    runs = (await t.request('GET', `${base}/messages`)).json.runs;
    expect(runs[2]).toMatchObject({ runId: c, status: 'completed', inputTokens: 12_000, costUsd: null });
  });
});

describe('session title at Hermes', () => {
  const patches = (t: Awaited<ReturnType<typeof testApp>>, id: string) =>
    t.fake.requests.filter((r) => r.method === 'PATCH' && r.path === `/api/sessions/${id}`);

  it('is pushed once, by the server, when the first run ends (not on the next ones)', async () => {
    const { t, s, base } = await session();
    const a = (await t.request('POST', `${base}/runs`, { input: 'Prépare le rapport' })).json.runId;
    await waitRun(t, base, a);
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(t, s.id).map((r) => r.body)).toEqual([{ title: 'Prépare le rapport' }]);
    const b = (await t.request('POST', `${base}/runs`, { input: 'Encore' })).json.runId;
    await waitRun(t, base, b);
    await t.request('GET', `${base}/messages`);
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(t, s.id)).toHaveLength(1);
  });

  it('is not pushed for a run Hermes forgot', async () => {
    const { t, s, base } = await session();
    const a = (await t.request('POST', `${base}/runs`, { input: 'lent' })).json.runId;
    t.fake.sim.runs.delete(a);
    await t.request('GET', `${base}/messages`);
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(t, s.id)).toHaveLength(0);
  });
});
