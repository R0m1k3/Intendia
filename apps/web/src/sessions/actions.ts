import type { BulkAction, Session } from '../api';
import { dayLabel } from './days';

/** Actions offered for a selection: each one only when it changes at least one session. */
export function selectionActions(sessions: Session[], selected: Set<string>): BulkAction[] {
  const picked = sessions.filter((s) => selected.has(s.id));
  if (!picked.length) return [];
  const out: BulkAction[] = [];
  if (picked.some((s) => !s.pinned)) out.push('pin');
  if (picked.some((s) => s.pinned)) out.push('unpin');
  if (picked.some((s) => !s.archived)) out.push('archive');
  if (picked.some((s) => s.archived)) out.push('unarchive');
  out.push('move', 'delete');
  return out;
}

export const ACTION_LABELS: Record<BulkAction, string> = {
  pin: 'Épingler', unpin: 'Désépingler', archive: 'Archiver', unarchive: 'Désarchiver', move: 'Déplacer vers…', delete: 'Supprimer',
};

/** Pinned sessions first (one group), then one group per day of last activity; the server's order is kept. */
export function groupSessions(list: Session[], now = Date.now()): { label: string; items: Session[] }[] {
  const out: { label: string; items: Session[] }[] = [];
  const pinned = list.filter((s) => s.pinned);
  if (pinned.length) out.push({ label: 'Épinglées', items: pinned });
  for (const s of list) {
    if (s.pinned) continue;
    const label = dayLabel(s.lastActiveAt ?? s.createdAt, now);
    const last = out.at(-1);
    if (last && last.label === label && last.label !== 'Épinglées') last.items.push(s);
    else out.push({ label, items: [s] });
  }
  return out;
}

/** "1 session" / "3 sessions". */
export const sessionsCount = (n: number): string => `${n} session${n > 1 ? 's' : ''}`;
