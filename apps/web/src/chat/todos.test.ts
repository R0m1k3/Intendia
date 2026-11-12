import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../api';
import { lastTodos, todoSummary, todoTree, type Todo } from './todos';

const tool = (id: number, content: unknown, toolName = 'todo_list'): ChatMessage => ({
  id, role: 'tool', content: typeof content === 'string' ? content : JSON.stringify(content), timestamp: id, toolName, toolCalls: [],
});

describe('todos', () => {
  it('reads the last list, skipping invalid results and other tools', () => {
    const msgs = [
      tool(1, { todos: [{ id: '1', content: 'Ancienne', status: 'pending' }] }),
      tool(2, { todos: [{ id: '1', content: 'Lire', status: 'completed' }, { id: '2', content: 'Écrire', status: 'in_progress' }] }),
      tool(3, '{"todos": [ coupé'),
      tool(4, { todos: [] }, 'terminal'),
    ];
    expect(lastTodos(msgs)?.map((t) => t.content)).toEqual(['Lire', 'Écrire']);
    expect(lastTodos([tool(1, 'pas du json')])).toBeNull();
    expect(lastTodos([])).toBeNull();
  });

  it('puts sub-tasks under their parent', () => {
    const list: Todo[] = [
      { id: 'a', content: 'A', status: 'pending' },
      { id: 'b', content: 'B', status: 'pending' },
      { id: 'a1', content: 'A1', status: 'pending', parent: 'a' },
      { id: 'x', content: 'X', status: 'pending', parent: 'inconnu' },
    ];
    expect(todoTree(list).map((r) => [r.todo.id, r.level])).toEqual([['a', 0], ['a1', 1], ['b', 0], ['x', 0]]);
    const cycle: Todo[] = [{ id: 'p', content: 'P', status: 'pending', parent: 'q' }, { id: 'q', content: 'Q', status: 'pending', parent: 'p' }];
    expect(todoTree(cycle).length).toBe(2);
  });

  it('counts without the cancelled ones and shows the first task in progress', () => {
    const list: Todo[] = [
      { id: '1', content: 'Un', status: 'completed' },
      { id: '2', content: 'Deux', status: 'cancelled' },
      { id: '3', content: 'Trois', status: 'in_progress' },
      { id: '4', content: 'Quatre', status: 'in_progress' },
    ];
    const s = todoSummary(list);
    expect([s.done, s.total, s.current?.id]).toEqual([1, 3, '3']);
    expect(todoSummary([{ id: '1', content: 'Un', status: 'pending' }]).current).toBeNull();
  });
});
