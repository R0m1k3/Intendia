import { describe, expect, it } from 'vitest';
import { ChannelRunner } from '../src/channels/runner.js';
import { testApp } from './helpers.js';

type T = Awaited<ReturnType<typeof testApp>>;

async function setup() {
  const t = await testApp({ extra: [{ id: 'maison', label: 'Maison', ownFake: true }] });
  await t.request('POST', '/x/workspaces', { slug: 'dev', name: 'Dev', instanceId: 'fake' });
  await t.request('POST', '/x/workspaces', { slug: 'casa', name: 'Casa', instanceId: 'maison' });
  const lines: string[] = [];
  const runner = new ChannelRunner({ ...t.services.runDeps, channels: t.services.channels, store: t.store }, (l) => lines.push(l));
  const created = await t.request('POST', '/x/channels', {
    name: 'Noël', instructions: 'Soyez brefs', lead: 0, members: [{ instanceId: 'fake', profile: 'default' }, { instanceId: 'maison', profile: 'default' }],
  });
  expect(created.status).toBe(201);
  return { t, runner, lines, id: created.json.channel.id as string };
}

const view = async (t: T, id: string) => (await t.request('GET', `/x/channels/${id}`)).json;
const fakeOf = (t: T, inst: string) => (t.fakes as Record<string, { sim: { runs: Map<string, { status: string; output: string; input: string }> } }>)[inst]!;

/** Passes until no turn is queued or running (each run of the fakes waited for). */
async function drive(t: T, id: string, runner: ChannelRunner, max = 40) {
  for (let i = 0; i < max; i++) {
    await runner.pass();
    const turns = (await view(t, id)).turns as { status: string }[];
    if (!turns.some((x) => x.status === 'queued' || x.status === 'running')) return;
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe('channels', () => {
  it('creates hidden sessions, the lead answers a message naming nobody', async () => {
    const { t, runner, id } = await setup();
    const v = await view(t, id);
    expect(v.members.map((m: { handle: string }) => m.handle)).toEqual(['default-fake', 'default-maison']);
    expect(v.channel.lead).toBe('default-fake');
    // the hidden sessions: archived, titled with the channel
    const s = t.services.workspaces.getSession('fake', v.members[0].sessionId).session;
    expect(s.archived).toBe(true);
    expect(s.title).toBe('Canal « Noël » · @default-fake');
    await t.request('POST', `/x/channels/${id}/messages`, { text: 'Où en est le catalogue ?' });
    await drive(t, id, runner);
    const after = await view(t, id);
    expect(after.messages.map((m: { author: string }) => m.author)).toEqual(['user', 'default-fake']);
    const run = [...fakeOf(t, 'fake').sim.runs.values()].at(-1)!;
    expect(run.input).toContain('Vous y êtes @default-fake, le chef du canal.');
    expect(run.input).toContain('— Utilisateur : Où en est le catalogue ?');
  });

  it('relays to the members named in an answer, then stops after the chain cap', async () => {
    const { t, runner, id } = await setup();
    // every answer of the fakes names the other member
    const name = (inst: string, other: string) => {
      const sim = fakeOf(t, inst).sim as unknown as { finish: (run: unknown, out: string) => void };
      const orig = sim.finish.bind(sim);
      sim.finish = (run, out) => orig(run, `${out} À toi @${other}`);
    };
    name('fake', 'default-maison');
    name('maison', 'default-fake');
    await t.request('POST', `/x/channels/${id}/messages`, { text: '@default-fake lance la chaîne' });
    await drive(t, id, runner, 120);
    const v = await view(t, id);
    const authors = v.messages.map((m: { author: string }) => m.author);
    // the user's message, then 6 answers (the first turn and 5 relays), then Intendia stops the chain
    expect(authors.filter((a: string) => a !== 'system' && a !== 'user')).toHaveLength(6);
    expect(v.messages.at(-1).text).toContain('Relais arrêtés');
  });

  it('a failed run stops the turn: continue, reassign or cancel', async () => {
    const { t, runner, id } = await setup();
    // through the service: no pass started by the route, this runner begins the turn
    t.services.channels.post(id, '@default-maison bonjour');
    await runner.pass();
    expect((await view(t, id)).turns[0].status).toBe('running');
    // Hermes forgot the run (a restart): the turn stops
    fakeOf(t, 'maison').sim.runs.clear();
    await drive(t, id, runner);
    let v = await view(t, id);
    const stopped = v.turns.find((x: { status: string }) => x.status === 'stopped');
    expect(stopped?.handle).toBe('default-maison');
    // nothing else is played while a turn waits for the decision
    await t.request('POST', `/x/channels/${id}/turns/${stopped.id}`, { action: 'reassign', handle: 'default-fake' });
    await drive(t, id, runner);
    v = await view(t, id);
    expect(v.messages.map((m: { author: string }) => m.author)).toEqual(['user', 'system', 'default-fake']);
    expect(v.messages[1].text).toBe('Tâche confiée à @default-fake à la place de @default-maison');
  });

  it('a message posted during a member\'s run reaches it at its next turn', async () => {
    const { t, runner, id } = await setup();
    t.services.channels.post(id, 'premier');
    await runner.pass();
    expect((await view(t, id)).turns[0].status).toBe('running');
    // posted while the lead runs: queued for the lead, never marked seen by its answer
    t.services.channels.post(id, 'deuxième');
    await drive(t, id, runner);
    const runs = [...fakeOf(t, 'fake').sim.runs.values()];
    expect(runs).toHaveLength(2);
    expect(runs[1]!.input).toContain('— Utilisateur : deuxième');
    expect(runs[1]!.input).not.toContain('premier');
    // its own answer is not sent back to it
    expect(runs[1]!.input).not.toContain('— @default-fake');
  });

  it('records the end of the hidden sessions\' runs for the channel cost', async () => {
    const { t, runner, id } = await setup();
    t.services.channels.post(id, 'combien ?');
    await drive(t, id, runner);
    const v = await view(t, id);
    const stats = t.services.workspaces.runStats('fake', v.members[0].sessionId);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.status).toBe('completed');
    expect(stats[0]!.endedAt).not.toBeNull();
  });
});
