import type { PendingApproval } from '../api';

/** Notifications to show: not the run of the session on screen (its page shows the card), not those put aside or answered. */
export function visibleApprovals(list: readonly PendingApproval[], { openSession, hidden }: { openSession?: string; hidden: ReadonlySet<string> }): PendingApproval[] {
  return list.filter((a) => a.sessionId !== openSession && !hidden.has(a.key));
}

/** Approvals not yet notified by the browser (one notification per key); `notified` is updated. */
export function toNotify(list: readonly PendingApproval[], notified: Set<string>): PendingApproval[] {
  const out = list.filter((a) => !notified.has(a.key));
  for (const a of out) notified.add(a.key);
  return out;
}
