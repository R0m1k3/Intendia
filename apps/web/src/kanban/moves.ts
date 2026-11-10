// Manual moves allowed by Hermes' workflow (`manual`): pure, unit-tested in moves.test.ts.

/** Statuses a task in `from` can be moved to by hand; `running` is never a target (only the dispatcher starts a worker). */
export function moveTargets(manual: Record<string, string[]>, from: string): string[] {
  return (manual[from] ?? []).filter((s) => s !== 'running' && s !== from);
}

export function canMove(manual: Record<string, string[]>, from: string, to: string): boolean {
  return moveTargets(manual, from).includes(to);
}

/** Board with a task moved to another column at once (optimistic), at the top of it. */
export function moveLocally<T extends { id: string; status: string }, C extends { key: string; tasks: T[] }>(columns: C[], taskId: string, to: string): C[] {
  const task = columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
  if (!task) return columns;
  return columns.map((c) => {
    const rest = c.tasks.filter((t) => t.id !== taskId);
    return { ...c, tasks: c.key === to ? [{ ...task, status: to }, ...rest] : rest };
  });
}

export const STATUS_LABEL: Record<string, string> = {
  triage: 'Triage', todo: 'À faire', scheduled: 'Planifiée', ready: 'Prête à lancer', running: 'En cours',
  blocked: 'Bloquée', review: 'En revue', done: 'Terminée', archived: 'Archivée',
};
export const statusLabel = (s: string, fallback?: string) => STATUS_LABEL[s] ?? fallback ?? s;
