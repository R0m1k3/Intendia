import { describe, expect, it } from 'vitest';
import type { ActiveRun, RecentSession } from '../api';
import { runMarks, withRunning, RUNNING_LABEL, type Group } from './running';

const run = (sessionId: string, at: number, more: Partial<ActiveRun> = {}): ActiveRun => ({
  instance: 'i', workspace: 'perso', workspaceName: 'Personnel', sessionId, title: `T ${sessionId}`, runId: `r-${sessionId}`,
  status: 'running', profile: 'default', lastActiveAt: at, ...more,
});
const row = (id: string, at: number, instanceId = 'i'): RecentSession => ({
  kind: 'intendia', instanceId, profile: 'default', id, source: 'intendia', title: id, sub: 'Personnel', workspace: 'perso', at, snippet: null,
});
const wait = (sessionId: string, instanceId = 'i') => ({ instanceId, sessionId, workspace: 'perso', workspaceName: 'Personnel', title: `Q ${sessionId}` });
const ids = (gs: Group<RecentSession>[]) => gs.map((g) => `${g.label}: ${g.items.map((s) => s.id).join(',')}`);

describe('runMarks', () => {
  it('a listed run is running whatever its status; the waiting feed wins; other instances ignored', () => {
    const m = runMarks([run('a', 1, { status: 'stopping' }), run('b', 2), run('x', 3, { instance: 'j' })],
      [wait('b'), wait('a', 'j')], 'i');
    expect(m.get('a')?.state).toBe('running');
    expect(m.get('b')?.state).toBe('waiting');
    expect(m.has('x')).toBe(false);
  });
  it('a session only in the waiting feed is marked, with its workspace and title', () => {
    const m = runMarks([], [wait('q')], 'i');
    expect(m.get('q')).toMatchObject({ state: 'waiting', workspace: 'perso', title: 'Q q' });
  });
});

describe('withRunning', () => {
  const groups: Group<RecentSession>[] = [{ label: 'Aujourd’hui', items: [row('a', 30), row('b', 20)] }, { label: 'Hier', items: [row('c', 10)] }];
  it('moves marked rows on top, most recently active first, and drops emptied groups', () => {
    const m = runMarks([run('c', 50), run('b', 40)], [], 'i');
    expect(ids(withRunning(groups, m, 'i', true))).toEqual([`${RUNNING_LABEL}: c,b`, 'Aujourd’hui: a']);
  });
  it('builds a row for a run whose session is not loaded, only with synth', () => {
    const m = runMarks([run('z', 60, { title: null })], [], 'i');
    const out = withRunning(groups, m, 'i', true);
    expect(ids(out)[0]).toBe(`${RUNNING_LABEL}: z`);
    expect(out[0]!.items[0]).toMatchObject({ title: 'Session sans titre', workspace: 'perso', sub: 'Personnel', snippet: null });
    expect(withRunning(groups, m, 'i', false)).toBe(groups);
  });
  it('without marks, the groups as they are; a waiting session not loaded gets a row', () => {
    expect(withRunning(groups, new Map(), 'i', true)).toBe(groups);
    expect(ids(withRunning(groups, runMarks([], [wait('q')], 'i'), 'i', true))[0]).toBe(`${RUNNING_LABEL}: q`);
  });
});

describe('runMarks: background sub-agents', () => {
  const sub = (sessionId: string, tasks: number, instance = 'i') => ({
    instance, sessionId, workspace: 'perso', workspaceName: 'Personnel', title: `S ${sessionId}`, profile: 'default', tasks, since: 100,
  });
  it('marked « subagents » with their count, below a run going on and a question of the agent', () => {
    const m = runMarks([run('b', 2)], [wait('c')], 'i', [sub('a', 2), sub('b', 1), sub('c', 3), sub('x', 1, 'j')]);
    expect(m.get('a')).toMatchObject({ state: 'subagents', subagents: 2, at: 100_000, title: 'S a' });
    expect(m.get('b')?.state).toBe('running');
    expect(m.get('c')?.state).toBe('waiting');
    expect(m.has('x')).toBe(false);
  });
  it('the session goes to « En cours »', () => {
    const m = runMarks([], [], 'i', [sub('a', 2)]);
    expect(ids(withRunning([{ label: 'Aujourd’hui', items: [row('a', 5), row('z', 4)] }], m, 'i', true))).toEqual([`${RUNNING_LABEL}: a`, 'Aujourd’hui: z']);
  });
});
