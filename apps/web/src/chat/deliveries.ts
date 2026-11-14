// Background sub-agents (Hermes 0.23: delegate_task in the background for an API server session). The run ends with
// a ticket; the result comes later as a delivery row (role `delegation`, read by the server). Pure functions:
// which units are still open, the status of each card's tasks once delivered, the live activity of their child
// sessions, and how often the page re-reads.
import type { ChatMessage, DelegationInfo, SubagentChild, SubagentsSummary } from '../api';
import type { Entry, SubagentNode } from './events';
import { plural, t } from '../i18n';
import { formatDuration } from './format';

export const EMPTY_DELIVERY: DelegationInfo = {
  id: null, tasks: null, completed: null, failed: null, durationSeconds: null, failedTask: null, taskStatuses: [], allFailed: false,
};

export interface DelegationState {
  /** unit ids still waiting for their delivery (without units: the call's id) */
  open: Set<string>;
  /**
   * seconds: newest ticket still open. The pace follows the latest delegation, so an abandoned ticket older than
   * 24 h never stops the re-reading of a new one (each card shows its own age).
   */
  since: number | null;
  /** by unit id, in Hermes' order (an early failure notice does not close its unit) */
  deliveries: Map<string, DelegationInfo[]>;
  /** call id → (task index → unit id), when the call was split in units */
  unitOf: Map<string, Map<number, string>>;
  /** units whose ticket is in the messages: one neither open nor delivered was given up (« non livré ») */
  ticketed: Set<string>;
}

/**
 * Computed on Hermes' messages (before withTrees): tickets, deliveries, units. `openUnits` = the server's decision
 * (route of the messages: lost units and the 24 h cut applied), which wins over the count made here.
 */
export function delegationState(messages: ChatMessage[], openUnits?: readonly string[]): DelegationState {
  const ticketed = new Set<string>();
  const openAt = new Map<string, number | null>();
  const deliveries = new Map<string, DelegationInfo[]>();
  const unitOf = new Map<string, Map<number, string>>();
  for (const m of messages) {
    if (m.role === 'tool') {
      // read by the server (`ticket`): the only reader of Hermes' format
      const t = m.ticket;
      if (!t) continue;
      if (t.units.length) {
        const map = new Map<number, string>();
        for (const u of t.units) {
          ticketed.add(u.id);
          for (const i of u.tasks) map.set(i, u.id);
          if (!deliveries.has(u.id) || !deliveries.get(u.id)!.some((d) => d.failedTask === null)) openAt.set(u.id, m.timestamp);
        }
        if (t.delegationId) unitOf.set(t.delegationId, map);
      } else if (t.delegationId) {
        ticketed.add(t.delegationId);
        openAt.set(t.delegationId, m.timestamp);
      }
    } else if (m.role === 'delegation' && m.delegation?.id) {
      const d = m.delegation;
      deliveries.set(d.id!, [...(deliveries.get(d.id!) ?? []), d]);
      if (d.failedTask === null) openAt.delete(d.id!);
    }
  }
  if (openUnits) {
    const server = new Set(openUnits);
    for (const id of [...openAt.keys()]) if (!server.has(id)) openAt.delete(id);
  }
  const times = [...openAt.values()].filter((v): v is number => v !== null);
  return { open: new Set(openAt.keys()), since: times.length ? Math.max(...times) : null, deliveries, unitOf, ticketed };
}

function deliveredStatus(d: DelegationInfo, taskIndex: number): string {
  const own = d.taskStatuses.find((t) => t.index === taskIndex) ?? d.taskStatuses.find((t) => t.index === null);
  if (own) return own.status;
  return d.allFailed || (d.tasks !== null && d.tasks > 0 && d.failed === d.tasks) ? 'failed' : 'completed';
}

/**
 * Updates every card (read from the history or live): delivered tasks get their status, a live node still
 * `running` after its run whose unit is open becomes `background`. `openSince` = oldest start of the card's
 * background nodes.
 */
export function applyDeliveries(entries: Entry[], state: DelegationState, runActive: boolean): Entry[] {
  return entries.map((e) => {
    if (e.kind !== 'subagents') return e;
    let changed = false;
    const nodes = e.nodes.map((n): SubagentNode => {
      if (n.delegationId === null || n.taskIndex === null) return n;
      const unit = state.unitOf.get(n.delegationId)?.get(n.taskIndex) ?? n.delegationId;
      const list = state.deliveries.get(unit) ?? [];
      const full = list.find((d) => d.failedTask === null);
      let status = n.status;
      if (full) status = deliveredStatus(full, n.taskIndex);
      else if (list.some((d) => d.failedTask === n.taskIndex)) status = 'failed';
      else if (n.status === 'running' && !runActive && state.open.has(unit)) status = 'background';
      // given up by the server (no delivery after its children ended, or « Ne plus attendre », or older than 24 h)
      else if ((n.status === 'background' || (n.status === 'running' && !runActive)) && state.ticketed.has(unit) && !state.open.has(unit)) status = 'lost';
      if (status === n.status) return n;
      changed = true;
      const { activity: _a, ...rest } = n;
      return status === 'background' ? { ...n, status } : { ...rest, status };
    });
    const starts = nodes.filter((n) => n.status === 'background').map((n) => n.startedAt).filter((v): v is number => v !== null);
    const openSince = starts.length ? Math.min(...starts) : undefined;
    if (!changed && openSince === e.openSince) return e;
    const { openSince: _o, ...base } = e;
    return openSince === undefined ? { ...base, nodes } : { ...base, nodes, openSince };
  });
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
/** A child started more than this before its node (ticket written after the children were queued) is another one. */
const CHILD_EARLY_S = 120;

/** Live activity of the background nodes, from their child sessions (by child session id, else by goal). */
export function attachChildren(entries: Entry[], children: SubagentChild[]): Entry[] {
  if (!children.length) return entries;
  const taken = new Set<string>();
  const byId = new Map(children.map((c) => [c.id, c]));
  return entries.map((e) => {
    if (e.kind !== 'subagents' || !e.nodes.some((n) => n.status === 'background')) return e;
    const nodes = e.nodes.map((n): SubagentNode => {
      if (n.status !== 'background') return n;
      let c = n.childSessionId ? byId.get(n.childSessionId) : undefined;
      if (c && taken.has(c.id)) c = undefined;
      if (!c) {
        const goal = norm(n.goal);
        c = children.find((x) => {
          if (taken.has(x.id) || !x.goal.trim()) return false;
          if (n.startedAt !== null && x.startedAt !== null && x.startedAt < n.startedAt - CHILD_EARLY_S) return false;
          const g = norm(x.goal);
          return x.cut ? goal.startsWith(g) : goal === g;
        });
      }
      if (!c) return n;
      taken.add(c.id);
      return { ...n, activity: { lastActive: c.lastActive, toolCalls: c.toolCalls, ended: c.endedAt !== null } };
    });
    return { ...e, nodes };
  });
}

/** One line above the delivered text (exact strings: see the plan of reviews/2026-11-12-sous-agents-fond). */
export function deliverySummary(info: DelegationInfo): string {
  if (info.failedTask !== null) return t('Sous-agent {n} en échec (les autres continuent)', { n: info.failedTask + 1 });
  const T = info.tasks;
  const F = info.failed ?? 0;
  let s: string;
  if (T === null) s = t('Résultat des sous-agents');
  else if (F === 0) s = plural(T, '{n} sous-agent terminé', '{n} sous-agents terminés');
  else if (F === T) s = plural(T, '{n} sous-agent en échec', '{n} sous-agents en échec');
  else s = t('{n} sous-agents, {f} en échec', { n: T, f: F });
  return info.durationSeconds ? `${s} · ${formatDuration(info.durationSeconds * 1000)}` : s;
}

/**
 * How often the page re-reads, from the server's summary: every 3 s while the server is about to wake the agent (the
 * new run is followed as soon as it starts), else while a unit is open 15 s for 10 min, then 60 s up to 24 h.
 */
export function pollDelay(summary: SubagentsSummary | null | undefined, nowSec: number): number | false {
  if (!summary) return false;
  if (summary.wakePending) return 3_000;
  // a unit given up less than 24 h ago: its delivery may still come
  if (summary.openTasks === 0 && summary.lostRecent) return 60_000;
  if (summary.openTasks === 0 || summary.since === null) return false;
  const age = nowSec - summary.since;
  if (age < 600) return 15_000;
  if (age < 86_400) return 60_000;
  return false;
}

/** More than 24 h without news: the page stops re-reading. */
export const STALE_AFTER_S = 86_400;
