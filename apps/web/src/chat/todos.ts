// The agent's task list (Hermes todo_list tool): its stored result is always the full list.
import type { ChatMessage } from '../api';

export interface Todo {
  id: string;
  content: string;
  /** pending | in_progress | completed | cancelled */
  status: string;
  parent?: string;
}

/** The list written by the last todo_list result of the session, null when there is none. */
export function lastTodos(messages: ChatMessage[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'tool' || m.toolName !== 'todo_list') continue;
    let data: unknown;
    try { data = JSON.parse(m.content); } catch { continue; }
    const todos = (data as { todos?: unknown } | null)?.todos;
    if (!Array.isArray(todos)) continue;
    return todos.flatMap((t): Todo[] => {
      if (!t || typeof t !== 'object') return [];
      const r = t as Record<string, unknown>;
      const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
      const content = typeof r.content === 'string' ? r.content : '';
      if (!id && !content) return [];
      const parent = typeof r.parent === 'string' || typeof r.parent === 'number' ? String(r.parent) : '';
      return [{ id, content, status: typeof r.status === 'string' ? r.status : 'pending', ...(parent ? { parent } : {}) }];
    });
  }
  return null;
}

/** Tasks in display order, sub-tasks under their parent (unknown parent: at the root). */
export function todoTree(list: Todo[]): { todo: Todo; level: number }[] {
  const ids = new Set(list.map((t) => t.id));
  const root = (t: Todo) => !t.parent || !ids.has(t.parent) || t.parent === t.id;
  const out: { todo: Todo; level: number }[] = [];
  const seen = new Set<Todo>();
  const walk = (t: Todo, level: number) => {
    if (seen.has(t)) return;
    seen.add(t);
    out.push({ todo: t, level });
    for (const c of list) if (!root(c) && c.parent === t.id) walk(c, level + 1);
  };
  for (const t of list) if (root(t)) walk(t, 0);
  for (const t of list) if (!seen.has(t)) out.push({ todo: t, level: 0 }); // cycles
  return out;
}

/** « 2/5 » without the cancelled ones; current = first task in progress, in list order. */
export function todoSummary(list: Todo[]): { done: number; total: number; current: Todo | null } {
  const kept = list.filter((t) => t.status !== 'cancelled');
  return {
    done: kept.filter((t) => t.status === 'completed').length,
    total: kept.length,
    current: list.find((t) => t.status === 'in_progress') ?? null,
  };
}
