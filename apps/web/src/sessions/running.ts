// Sessions whose agent is working, put forward in the session list (SessionsPane): an « En cours » group on top.

import type { ActiveRun, RecentSession, WorkingSubagents } from '../api';

/** subagents: no run goes on, background sub-agents of the session still work (the server wakes the agent after) */
export type RunState = 'running' | 'waiting' | 'subagents';
export interface RunMark {
  state: RunState; at: number; title: string | null; workspace: string; workspaceName: string; profile: string;
  /** background sub-agents still working */
  subagents?: number;
}
/** A group of the list, as `groupByDay` gives it. */
export type Group<T> = { label: string; items: T[] };

export const RUNNING_LABEL = 'En cours';

/**
 * Marks by session id: a run listed by `/activity` (every status it keeps: queued, running, stopping…) is running;
 * a session in the waiting feed (`/approvals`: approvals and the agent's questions, which `/activity` does not tell
 * apart) waits for the user. Other instances ignored.
 */
export function runMarks(
  runs: readonly ActiveRun[],
  waiting: readonly { instanceId: string; sessionId: string; workspace: string; workspaceName: string; title: string | null }[],
  inst: string,
  subagents: readonly WorkingSubagents[] = [],
): Map<string, RunMark> {
  const out = new Map<string, RunMark>();
  // lowest priority: a run going on or a question of the agent replaces it
  for (const w of subagents) {
    if (w.instance !== inst) continue;
    out.set(w.sessionId, {
      state: 'subagents', at: (w.since ?? 0) * 1000, title: w.title, workspace: w.workspace, workspaceName: w.workspaceName, profile: w.profile, subagents: w.tasks,
    });
  }
  for (const r of runs) {
    if (r.instance !== inst) continue;
    out.set(r.sessionId, { state: 'running', at: r.lastActiveAt, title: r.title, workspace: r.workspace, workspaceName: r.workspaceName, profile: r.profile });
  }
  for (const w of waiting) {
    if (w.instanceId !== inst) continue;
    const m = out.get(w.sessionId);
    // known only from the feed (the run was not read this time): put forward all the same
    if (m) out.set(w.sessionId, { ...m, state: 'waiting' });
    else out.set(w.sessionId, { state: 'waiting', at: Date.now(), title: w.title, workspace: w.workspace, workspaceName: w.workspaceName, profile: 'default' });
  }
  return out;
}

/**
 * The « En cours » group on top, most recently active first: loaded rows that are marked leave their day; with
 * `synth` (source filter « Toutes » or « Intendia »), a run whose session is not loaded gets a row built from it.
 * Empty groups dropped; without marks, `groups` as is.
 */
export function withRunning(groups: Group<RecentSession>[], marks: ReadonlyMap<string, RunMark>, inst: string, synth: boolean): Group<RecentSession>[] {
  if (!marks.size) return groups;
  const top: { row: RecentSession; at: number }[] = [];
  const rest = groups
    .map((g) => ({ ...g, items: g.items.filter((s) => {
      const m = marks.get(s.id);
      if (!m || s.instanceId !== inst) return true;
      top.push({ row: s, at: m.at || s.at });
      return false;
    }) }))
    .filter((g) => g.items.length);
  if (synth) {
    for (const [id, m] of marks) {
      if (!m.workspace || top.some((x) => x.row.id === id)) continue;
      top.push({
        at: m.at,
        row: { kind: 'intendia', instanceId: inst, profile: m.profile, id, source: 'intendia', title: m.title ?? 'Session sans titre', sub: m.workspaceName, workspace: m.workspace, at: m.at, snippet: null },
      });
    }
  }
  if (!top.length) return groups;
  top.sort((a, b) => b.at - a.at);
  return [{ label: RUNNING_LABEL, items: top.map((x) => x.row) }, ...rest];
}
