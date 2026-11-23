import { describe, expect, it } from 'vitest';
import type { Agent, RecentSession, Workspace } from '../api';
import { agentColor, agentInitials, agentTree } from './agentTree';
import type { RunMark } from './running';

const agent = (name: string, extra: Partial<Agent> = {}): Agent => ({
  name, isDefault: name === 'default', description: '', model: null, provider: null, skillCount: null, gatewayRunning: null, hasKey: true, workers: null, ...extra,
});
const ws = (slug: string, profile: string | null = null): Workspace => ({ slug, name: slug.toUpperCase(), instanceId: 'i', profile, model: null, modelProvider: null, effort: null, createdAt: 1 });
const s = (id: string, at: number, extra: Partial<RecentSession> = {}): RecentSession => ({
  kind: 'intendia', instanceId: 'i', profile: 'default', id, source: 'intendia', title: id, sub: '', workspace: null, at, snippet: null, ...extra,
});
const mark = (state: RunMark['state']): RunMark => ({ state, at: 0, title: null, workspace: '', workspaceName: '', profile: 'default' });

describe('agentTree', () => {
  const agents = [agent('veille'), agent('default')];
  const workspaces = [ws('shop'), ws('prix', 'veille'), ws('vide', 'veille')];
  const sessions = [
    s('a', 50, { workspace: 'shop' }),
    s('b', 40, { profile: 'veille', workspace: 'prix' }),
    s('c', 30, { kind: 'hermes', source: 'telegram', profile: 'veille' }),
    s('d', 20, { profile: 'ghost', kind: 'hermes', source: 'cli' }),
    s('e', 10, { workspace: 'shop', pinned: true }),
  ];
  const marks = new Map([['b', mark('waiting')], ['a', mark('running')]]);

  it('agents (default first), their folders (even empty) and other conversations; unknown agents from sessions', () => {
    const tree = agentTree({ sessions, agents, workspaces, marks, isUnread: (x) => x.id === 'c' });
    expect(tree.agents.map((a) => a.name)).toEqual(['default', 'veille', 'ghost']);
    const [def, veille, ghost] = tree.agents;
    expect(def?.folders.map((f) => [f.workspace.slug, f.sessions.map((x) => x.id)])).toEqual([['shop', ['a', 'e']]]);
    expect(veille?.folders.map((f) => [f.workspace.slug, f.sessions.map((x) => x.id)])).toEqual([['prix', ['b']], ['vide', []]]);
    expect(veille?.others.map((x) => x.id)).toEqual(['c']);
    expect(veille?.state).toBe('waiting');
    expect(veille?.unread).toBe(1);
    expect(def?.state).toBe('running');
    expect(ghost).toMatchObject({ known: false, others: [expect.objectContaining({ id: 'd' })] });
  });

  it('top groups: waiting, working, pinned', () => {
    const tree = agentTree({ sessions, agents, workspaces, marks, isUnread: () => false });
    expect(tree.needsYou.map((x) => x.id)).toEqual(['b']);
    expect(tree.working.map((x) => x.id)).toEqual(['a']);
    expect(tree.pinned.map((x) => x.id)).toEqual(['e']);
  });

  it('filters keep only matching sessions and drop empty agents and folders', () => {
    const running = agentTree({ sessions, agents, workspaces, marks, isUnread: () => false, filter: 'running' });
    expect(running.agents.map((a) => [a.name, a.folders.map((f) => f.workspace.slug)])).toEqual([['default', ['shop']], ['veille', ['prix']]]);
    const unread = agentTree({ sessions, agents, workspaces, marks, isUnread: (x) => x.id === 'd', filter: 'unread' });
    expect(unread.agents.map((a) => a.name)).toEqual(['ghost']);
  });

  it('agents unreadable: folders still shown under their profile', () => {
    const tree = agentTree({ sessions: [], agents: undefined, workspaces, marks: new Map(), isUnread: () => false });
    expect(tree.agents.map((a) => [a.name, a.folders.length])).toEqual([['default', 1], ['veille', 2]]);
  });

  it('avatar: stable colour, initials', () => {
    expect(agentColor('veille')).toBe(agentColor('veille'));
    expect(agentInitials('default')).toBe('D');
    expect(agentInitials('veille-prix')).toBe('VP');
  });
});
