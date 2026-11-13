// Automatic wake of the agent once its background sub-agents delivered (Hermes 0.23 opens no turn at a delivery: the
// client owns the next turn). Every 15 s, the server reads the Intendia sessions that wait for sub-agents; when the
// last open unit of a session is delivered and no run goes on, it sends one fixed message, so the agent goes on with
// the results, every tab closed. A delivery is answered once (table delegation_wakes), 5 wakes in a row at most
// without any other run. Plan: reviews/2026-11-13-reprise-sous-agents/plan.md (topic intendia).
import { and, desc, eq, lt } from 'drizzle-orm';
import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import type { Db } from '../db/index.js';
import { delegationWakes } from '../db/schema.js';
import { NotFoundError, type RecentRun, type SessionContext } from '../workspaces/service.js';
import { delegationState, summarizeOpen } from './delegation.js';
import { WAKE_PREFIX } from './goal.js';
import { readHistory, readRunStatus, runKey, startingRuns, type ChatMessage } from './history.js';
import { RunBusyError, startRun, type StartRunDeps } from './start-run.js';

export const MAX_WAKES = 5;
/** Never contains « fond »: the fake plays background sub-agents on that word (a wake would delegate again). */
export const WAKE_TEXT = `${WAKE_PREFIX} : tes sous-agents ont terminé, leurs résultats sont ci-dessus. Poursuis ton travail.`;
/** Messages read per decision (the watcher's and the page's summary use the same window). */
export const WAKE_WINDOW = 200;
const EVERY_MS = 15_000;
const SLOW_MS = 60_000;
/** a ticket younger than this is re-read every 15 s, then every 60 s */
const FAST_FOR_S = 600;
/** a unit without news for longer is not waited for any more */
const OPEN_MAX_S = 86_400;
const WINDOW_MS = 24 * 3600_000;
const CANDIDATES = 50;
const START_TRIES = 3;
const KEEP_ROWS_MS = 7 * 24 * 3600_000;
/** the page shows « l'agent reprend » this long after a delivery the server has not answered yet */
const PENDING_FOR_S = 600;

export type WakeKind = 'wake' | 'capped' | 'wait' | 'quiet';

export interface WakeDecision {
  kind: WakeKind;
  /** wake / capped: the delivery answered (dedup key) */
  key: string | null;
  /** seconds: time of the delivery answered */
  deliveredAt: number | null;
  /** tasks of the units still open (ticket younger than 24 h) */
  openTasks: number;
  since: number | null;
}

/** What the page of a session is told (route of the messages): the server's decision, never re-computed by the web. */
export interface SubagentsSummary {
  openTasks: number;
  /** seconds: newest ticket still open */
  since: number | null;
  /** 5 wakes in a row: no more until the user writes */
  capped: boolean;
  /** the last unit is delivered, the wake is about to start */
  wakePending: boolean;
}

export interface WorkingSubagents {
  instance: string;
  sessionId: string;
  workspace: string;
  workspaceName: string;
  title: string | null;
  profile: string;
  tasks: number;
  /** seconds */
  since: number | null;
}

const keyOf = (m: ChatMessage): string => (Number.isInteger(m.id) ? `m:${m.id}` : `d:${m.delegation?.id ?? '?'}:${m.timestamp ?? ''}`);

/**
 * Pure. The queue = messages after the last one that is neither a delivery nor empty. Wake when the queue holds a
 * full delivery (an early failure notice does not count) and no unit younger than 24 h is still open.
 */
export function wakeDecision(messages: readonly ChatMessage[], nowSec: number, prevChain: number): WakeDecision {
  const window = messages.slice(-WAKE_WINDOW);
  const st = delegationState(window);
  const fresh = new Map([...st.open].filter(([, u]) => u.ts !== null && nowSec - u.ts < OPEN_MAX_S));
  const { openTasks, since } = summarizeOpen(fresh);
  let i = window.length;
  while (i > 0 && (window[i - 1]!.role === 'delegation' || !window[i - 1]!.content.trim())) i--;
  const queue = window.slice(i);
  const full = queue.some((m) => m.role === 'delegation' && m.delegation && m.delegation.failedTask === null);
  const base = { openTasks, since, key: null, deliveredAt: null };
  if (full && fresh.size === 0) {
    const last = queue.filter((m) => m.role === 'delegation').at(-1)!;
    return { ...base, kind: prevChain >= MAX_WAKES ? 'capped' : 'wake', key: keyOf(last), deliveredAt: last.timestamp };
  }
  return { ...base, kind: fresh.size ? 'wait' : 'quiet' };
}

type WakeRow = typeof delegationWakes.$inferSelect;

/** Pure: the summary served with the messages; null = nothing open, nothing expected. */
export function summarize(d: WakeDecision, row: WakeRow | null, nowSec: number): SubagentsSummary | null {
  // a delivery not answered yet: pending only while recent (a session the watcher does not read, as a copy, never waits)
  const pending = d.kind === 'wake' && (row ? row.state === 'starting' : d.deliveredAt !== null && nowSec - d.deliveredAt < PENDING_FOR_S);
  const capped = d.kind === 'capped';
  if (d.openTasks === 0 && !pending && !capped) return null;
  return { openTasks: d.openTasks, since: d.since, capped, wakePending: pending };
}

/** Rows of the wakes (one per delivery answered). */
export class WakeStore {
  constructor(private readonly db: Db) {}

  private key(instanceId: string, sessionId: string, deliveryKey: string) {
    return and(eq(delegationWakes.instanceId, instanceId), eq(delegationWakes.sessionId, sessionId), eq(delegationWakes.deliveryKey, deliveryKey));
  }

  get(instanceId: string, sessionId: string, deliveryKey: string): WakeRow | null {
    return this.db.select().from(delegationWakes).where(this.key(instanceId, sessionId, deliveryKey)).get() ?? null;
  }

  /** Before the start: true when the row is new (an existing one = this delivery was already answered). */
  reserve(instanceId: string, sessionId: string, deliveryKey: string, chain: number, now = Date.now()): boolean {
    const res = this.db.insert(delegationWakes)
      .values({ instanceId, sessionId, deliveryKey, state: 'starting', runId: null, chain, createdAt: now })
      .onConflictDoNothing().run();
    return res.changes > 0;
  }

  started(instanceId: string, sessionId: string, deliveryKey: string, runId: string): void {
    this.db.update(delegationWakes).set({ state: 'started', runId }).where(this.key(instanceId, sessionId, deliveryKey)).run();
  }

  release(instanceId: string, sessionId: string, deliveryKey: string): void {
    this.db.delete(delegationWakes).where(this.key(instanceId, sessionId, deliveryKey)).run();
  }

  abandon(instanceId: string, sessionId: string, deliveryKey: string): void {
    this.db.update(delegationWakes).set({ state: 'abandoned' }).where(this.key(instanceId, sessionId, deliveryKey)).run();
  }

  /** Rank of the last wake when its run is still the session's last run (no other run since), else 0. */
  prevChain(instanceId: string, sessionId: string, lastRunId: string | null): number {
    if (!lastRunId) return 0;
    const last = this.db.select().from(delegationWakes)
      .where(and(eq(delegationWakes.instanceId, instanceId), eq(delegationWakes.sessionId, sessionId), eq(delegationWakes.state, 'started')))
      .orderBy(desc(delegationWakes.createdAt)).limit(1).get();
    return last && last.runId === lastRunId ? last.chain : 0;
  }

  /** At start: a start cut by a restart is abandoned (never retried: at most one wake lost); old rows go. */
  cleanup(now = Date.now()): void {
    this.db.update(delegationWakes).set({ state: 'abandoned' }).where(eq(delegationWakes.state, 'starting')).run();
    this.db.delete(delegationWakes).where(lt(delegationWakes.createdAt, now - KEEP_ROWS_MS)).run();
  }
}

interface Watch {
  run: RecentRun;
  /** the session's last run when it was read */
  lastRunId: string;
  /** nothing to do until the session's last run changes (quiet, capped, delivery already answered) */
  calm: boolean;
  nextAt: number;
  open: { tasks: number; since: number | null } | null;
  tries: number;
}

type Start = (deps: StartRunDeps, ctx: SessionContext, input: string) => Promise<{ runId: string }>;

export class DelegationWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly watches = new Map<string, Watch>();
  private readonly log: (line: string) => void;
  private readonly startFn: Start;

  constructor(
    private readonly deps: StartRunDeps & { wakes: WakeStore },
    /** start: replaces startRun in the tests only */
    opts: { log?: (line: string) => void; start?: Start } = {},
  ) {
    this.log = opts.log ?? ((l) => console.error(l));
    this.startFn = opts.start ?? ((d, ctx, input) => startRun(d, ctx, input));
  }

  /** One pass; returns the decision per session read (`<instance>/<session>`), for the tests. */
  async pass(now = Date.now()): Promise<Map<string, WakeKind | 'running'>> {
    const out = new Map<string, WakeKind | 'running'>();
    if (this.busy) return out;
    this.busy = true;
    try {
      const due = (r: RecentRun) => {
        const w = this.watches.get(`${r.instanceId}/${r.sessionId}`);
        return !w || w.lastRunId !== r.runId || (!w.calm && w.nextAt <= now);
      };
      const candidates = this.deps.workspaces.recentRuns(now - WINDOW_MS, CANDIDATES, due);
      for (const r of candidates) {
        const key = `${r.instanceId}/${r.sessionId}`;
        try {
          out.set(key, await this.step(r, now));
        } catch (err) {
          // Hermes unreachable, database busy: the next pass reads it again
          this.log(`[intendia] reprise ${key} : ${(err as Error).message}`);
        }
      }
      // sessions out of the window are no longer followed
      for (const [k, w] of this.watches) if (w.run.lastActiveAt < now - WINDOW_MS && !(w.open && w.open.since !== null && now / 1000 - w.open.since < OPEN_MAX_S)) this.watches.delete(k);
    } finally {
      this.busy = false;
    }
    return out;
  }

  private async step(r: RecentRun, now: number): Promise<WakeKind | 'running'> {
    const key = `${r.instanceId}/${r.sessionId}`;
    const old = this.watches.get(key);
    const w: Watch = old && old.lastRunId === r.runId
      ? { ...old, run: r }
      : { run: r, lastRunId: r.runId, calm: false, nextAt: 0, open: old?.open ?? null, tries: 0 };
    this.watches.set(key, w);
    const later = (ms: number) => { w.nextAt = now + ms - 1_000; };
    // a send being started, or a run going on: Hermes writes no delivery during a turn
    if (startingRuns.has(runKey(r.instanceId, r.sessionId))) { later(EVERY_MS); return 'running'; }
    let ctx: SessionContext;
    try {
      ctx = this.deps.workspaces.getSession(r.instanceId, r.sessionId);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      w.calm = true;
      return 'quiet';
    }
    const s = await readRunStatus(this.deps.compat, r.instanceId, ctx.profile, r.runId);
    if (s.status !== 'unknown' && !TERMINAL_STATUSES.includes(s.status)) { later(EVERY_MS); return 'running'; }
    const h = await readHistory(this.deps.compat, r.instanceId, r.sessionId, ctx.profile, WAKE_WINDOW);
    const prev = this.deps.wakes.prevChain(r.instanceId, r.sessionId, r.runId);
    const d = wakeDecision(h.messages, now / 1000, prev);
    w.open = d.openTasks > 0 ? { tasks: d.openTasks, since: d.since } : null;
    if (d.kind === 'quiet' || d.kind === 'capped') {
      w.calm = true;
      if (d.kind === 'capped' && !old?.calm) this.log(`[intendia] reprise ${key} : arrêtée après ${MAX_WAKES} reprises de suite`);
      return d.kind;
    }
    if (d.kind === 'wait') {
      later(d.since !== null && now / 1000 - d.since < FAST_FOR_S ? EVERY_MS : SLOW_MS);
      return 'wait';
    }
    const dk = d.key!;
    const { wakes } = this.deps;
    if (wakes.get(r.instanceId, r.sessionId, dk) || !wakes.reserve(r.instanceId, r.sessionId, dk, prev + 1, now)) {
      // already answered (a wake run that failed at Hermes leaves the same delivery in the queue)
      w.calm = true;
      return 'quiet';
    }
    try {
      const res = await this.startFn(this.deps, ctx, WAKE_TEXT);
      wakes.started(r.instanceId, r.sessionId, dk, res.runId);
      this.log(`[intendia] reprise ${key} : run ${res.runId} (${prev + 1}/${MAX_WAKES})`);
      this.watches.set(key, { run: { ...r, runId: res.runId }, lastRunId: res.runId, calm: false, nextAt: 0, open: null, tries: 0 });
      return 'wake';
    } catch (err) {
      if (err instanceof RunBusyError) {
        // the user (or the goal) started a run meanwhile: it takes the delivery with it
        wakes.release(r.instanceId, r.sessionId, dk);
        later(EVERY_MS);
        return 'running';
      }
      w.tries += 1;
      if (w.tries >= START_TRIES) {
        wakes.abandon(r.instanceId, r.sessionId, dk);
        w.calm = true;
        this.log(`[intendia] reprise ${key} : abandonnée après ${START_TRIES} échecs (${(err as Error).message})`);
        return 'quiet';
      }
      wakes.release(r.instanceId, r.sessionId, dk);
      later(EVERY_MS);
      throw err;
    }
  }

  /** Sessions whose sub-agents still work (units open for less than 24 h), as last read. */
  working(instanceId?: string, now = Date.now()): WorkingSubagents[] {
    const out: WorkingSubagents[] = [];
    for (const w of this.watches.values()) {
      if (!w.open || w.open.tasks <= 0 || (instanceId !== undefined && w.run.instanceId !== instanceId)) continue;
      if (w.open.since !== null && now / 1000 - w.open.since >= OPEN_MAX_S) continue;
      const r = w.run;
      out.push({
        instance: r.instanceId, sessionId: r.sessionId, workspace: r.workspaceSlug, workspaceName: r.workspaceName,
        title: r.title, profile: r.profile, tasks: w.open.tasks, since: w.open.since,
      });
    }
    return out;
  }

  start(): void {
    if (this.timer) return;
    this.deps.wakes.cleanup();
    this.timer = setInterval(() => void this.pass().catch((err) => this.log(`[intendia] reprise : ${(err as Error).message}`)), EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
