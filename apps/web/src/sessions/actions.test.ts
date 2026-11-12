import { describe, expect, it } from 'vitest';
import type { Session } from '../api';
import { groupSessions, selectionActions } from './actions';

const now = new Date(2026, 10, 11, 15).getTime();
const day = 24 * 3600 * 1000;
const s = (id: string, extra: Partial<Session> = {}): Session => ({
  id, instanceId: 'i', workspace: 'w', title: id, archived: false, lastRunId: null, lastActiveAt: now, createdAt: now,
  model: null, modelProvider: null, effort: null, pinned: false, copiedFrom: null, replacesId: null, ...extra,
});

describe('selectionActions', () => {
  it('offers only the actions that change something', () => {
    const list = [s('a'), s('b', { pinned: true }), s('c', { archived: true })];
    expect(selectionActions(list, new Set())).toEqual([]);
    expect(selectionActions(list, new Set(['a']))).toEqual(['pin', 'archive', 'move', 'delete']);
    expect(selectionActions(list, new Set(['b', 'c']))).toEqual(['pin', 'unpin', 'archive', 'unarchive', 'move', 'delete']);
  });
});

describe('groupSessions', () => {
  it('puts pinned first, then one group per day, order kept', () => {
    const list = [s('p', { pinned: true, lastActiveAt: now - 5 * day }), s('a'), s('b', { lastActiveAt: now - day }), s('c', { lastActiveAt: now - day - 1000 })];
    const g = groupSessions(list, now);
    expect(g.map((x) => x.label)).toEqual(['Épinglées', 'Aujourd’hui', 'Hier']);
    expect(g.map((x) => x.items.map((i) => i.id))).toEqual([['p'], ['a'], ['b', 'c']]);
  });
  it('has no pinned group without pinned sessions', () => {
    expect(groupSessions([s('a', { lastActiveAt: null })], now).map((x) => x.label)).toEqual(['Aujourd’hui']);
  });
});
