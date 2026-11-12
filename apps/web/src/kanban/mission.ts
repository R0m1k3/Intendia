import type { KanbanMissionChild, KanbanMissionState } from '../api';

/** Children in an order where each comes after those it waits for (Hermes' order kept otherwise). */
export function orderChildren(children: KanbanMissionChild[]): KanbanMissionChild[] {
  const ids = new Set(children.map((c) => c.id));
  const placed = new Set<string>();
  const out: KanbanMissionChild[] = [];
  let left = [...children];
  while (left.length) {
    const next = left.filter((c) => c.after.every((p) => placed.has(p) || !ids.has(p)));
    // a loop (should not happen): the rest as given
    const take = next.length ? next : left;
    for (const c of take) {
      out.push(c);
      placed.add(c.id);
    }
    left = left.filter((c) => !placed.has(c.id));
  }
  return out;
}

export const MISSION_STATE: Record<KanbanMissionState, string> = {
  decomposing: 'découpage en cours',
  held: 'à relire',
  launched: 'lancée',
  failed: 'en échec',
  cancelled: 'annulée',
};

/** Short notes under a child: what it waits for, and why it is not held. */
export function childNotes(c: KanbanMissionChild, all: KanbanMissionChild[], launched: boolean): string[] {
  const notes: string[] = [];
  const names = c.after.map((id) => all.find((x) => x.id === id)?.title).filter((t): t is string => Boolean(t));
  if (names.length) notes.push(`après : ${names.join(', ')}`);
  if (c.lostTracking) notes.push('suivi perdu : un worker la fait déjà tourner');
  else if (!c.held && !launched && c.status !== 'archived') notes.push('déjà lancée par Hermes');
  if (!c.assignee) notes.push('sans agent : ne partira pas');
  return notes;
}
