import { describe, expect, it } from 'vitest';
import { canMove, moveLocally, moveTargets } from './moves';

const manual = { triage: ['ready', 'todo'], todo: ['ready', 'scheduled', 'triage'], blocked: ['done', 'ready', 'todo'], running: ['blocked', 'done', 'ready', 'running'] };

describe('moves', () => {
  it('follows the workflow, never targets running', () => {
    expect(moveTargets(manual, 'todo')).toEqual(['ready', 'scheduled', 'triage']);
    expect(moveTargets(manual, 'running')).toEqual(['blocked', 'done', 'ready']);
    expect(canMove(manual, 'triage', 'running')).toBe(false);
    expect(canMove(manual, 'todo', 'done')).toBe(false);
  });

  it('has no target for an unknown status', () => {
    expect(moveTargets(manual, 'nouveau')).toEqual([]);
  });

  it('moves a card at once, to the top of its new column', () => {
    const cols = [
      { key: 'todo', tasks: [{ id: 'a', status: 'todo' }, { id: 'b', status: 'todo' }] },
      { key: 'ready', tasks: [{ id: 'c', status: 'ready' }] },
    ];
    const out = moveLocally(cols, 'b', 'ready');
    expect(out.map((c) => c.tasks.map((t) => `${t.id}:${t.status}`))).toEqual([['a:todo'], ['b:ready', 'c:ready']]);
    expect(moveLocally(cols, 'zz', 'ready')).toBe(cols);
  });
});
