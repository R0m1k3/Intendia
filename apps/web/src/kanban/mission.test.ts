import { describe, expect, it } from 'vitest';
import type { KanbanMissionChild } from '../api';
import { childNotes, orderChildren } from './mission';

const c = (id: string, after: string[] = [], extra: Partial<KanbanMissionChild> = {}): KanbanMissionChild => ({
  id, title: id.toUpperCase(), body: '', status: 'scheduled', assignee: 'default', after, held: true, lostTracking: false, ...extra,
});

describe('orderChildren', () => {
  it('puts a child after the ones it waits for, keeps Hermes order otherwise', () => {
    expect(orderChildren([c('c', ['a']), c('a'), c('b')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(orderChildren([c('a'), c('b'), c('c', ['b'])]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('ignores a parent outside the mission and survives a loop', () => {
    expect(orderChildren([c('a', ['zz']), c('b')]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(orderChildren([c('a', ['b']), c('b', ['a'])]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('childNotes', () => {
  const all = [c('a'), c('b', ['a'])];
  it('names what a child waits for', () => {
    expect(childNotes(all[1]!, all, false)).toEqual(['après : A']);
  });
  it('says when Hermes launched it first, when the tracking is lost, when no agent is set', () => {
    expect(childNotes(c('x', [], { held: false, status: 'running' }), all, false)).toEqual(['déjà lancée par Hermes']);
    expect(childNotes(c('x', [], { held: false, status: 'running' }), all, true)).toEqual([]);
    expect(childNotes(c('x', [], { lostTracking: true }), all, false)).toEqual(['suivi perdu : un worker la fait déjà tourner']);
    expect(childNotes(c('x', [], { assignee: null }), all, false)).toEqual(['sans agent : ne partira pas']);
  });
});
