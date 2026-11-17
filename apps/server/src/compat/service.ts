import { desc, eq } from 'drizzle-orm';
import type { CompatReport } from '../connectors/types.js';
import type { Db } from '../db/index.js';
import { compatReports } from '../db/schema.js';
import type { WsFactory } from '../hermes/events.js';
import { probeSocket } from '../hermes/gateway-ws.js';
import { HermesHttp, isMissingRoute, isTransient, type FetchLike, type HermesError, type HermesObserver, type Via } from '../hermes/http.js';
import type { InstanceStore } from '../instances/store.js';
import { MODULES } from '../connectors/index.js';
import { checkInstance, stateChanges } from './engine.js';
import { withFilesRoot } from './files-root.js';
import type { Notifier } from './notify.js';

const KEEP_REPORTS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_ROOT_RETRY_MS = 15 * 60 * 1000;
/** Step of the follow-up of an unhealthy report. */
export const FOLLOW_MS = 30_000;
/** Full checks of the follow-up for `none` / `error` / `transient`; then the tick takes over. */
export const FOLLOW_CHECKS = 3;
const PROBE_TIMEOUT_MS = 5_000;
/** Runtime signals: at most one recheck per instance and group in this delay. */
export const DEBOUNCE_MS = { auth: 30_000, shape: 180_000, down: 300_000 } as const;
type Group = keyof typeof DEBOUNCE_MS;

/**
 * Why a report is not healthy. `none`: no report; `error`: the last full check failed; `api-down` / `dash-down`: a side
 * did not answer (`outage`); `transient`: a probe failed with a passing error; `api-refused` / `dash-refused`: key or
 * token refused; `no-root`: no files root while the dashboard answers.
 */
export type Cause = 'none' | 'error' | 'api-down' | 'dash-down' | 'transient' | 'api-refused' | 'dash-refused' | 'no-root';
/** Causes the follow-up handles by itself; the others need the user and are left to the tick. */
const FOLLOWED: ReadonlySet<Cause> = new Set(['none', 'error', 'transient', 'api-down', 'dash-down']);
const RETRIED: ReadonlySet<Cause> = new Set(['none', 'error', 'transient']);
const SIDES = ['api', 'dash'] as const;

export function causes(r: CompatReport | undefined, failed: boolean): Cause[] {
  const out: Cause[] = [];
  if (!r) out.push('none');
  if (failed) out.push('error');
  if (!r) return out;
  if (r.outage?.api) out.push('api-down');
  if (r.outage?.dash) out.push('dash-down');
  if (r.files?.transient || r.modules.some((m) => Object.values(m.ops).some((o) => !o.ok && o.transient))) out.push('transient');
  if (r.api.auth === 'refused') out.push('api-refused');
  if (r.dash.auth === 'refused') out.push('dash-refused');
  if (r.files && r.files.workspaceRoot === null && r.dash.reachable && !r.files.transient) out.push('no-root');
  return out;
}

/**
 * Follow-up of one instance whose report has a followed cause. `causes`: the followed causes it was made for;
 * `probeOk`: last result of the public probe of each side; `busy`: a step runs. A follow-up whose retries are spent
 * (and with no side down) stays, without timer, so that the tick's checks do not start it again.
 */
interface Follow { checks: number; causes: string; probeOk: { api: boolean; dash: boolean }; timer?: NodeJS.Timeout; busy: boolean }

const noop = () => undefined;

/** Operations of this version of Intendia (`module.op`) that a report does not have (saved by an older version). */
export function uncheckedOps(report: CompatReport): string[] {
  const out: string[] = [];
  for (const mod of MODULES) {
    const ops = report.modules.find((m) => m.id === mod.id)?.ops ?? {};
    for (const name of Object.keys(mod.ops)) if (!(name in ops)) out.push(`${mod.id}.${name}`);
  }
  // saved before Intendia 0.1.5: the idempotency of runs was not read
  if (report.runs === undefined) out.push('chat.runsIdempotency');
  return out;
}

/**
 * Keeps one compatibility report per instance. Full checks run at boot, on demand, on runtime signals of the clients
 * (`http(id)`: refused token, missing route, unexpected shape, outage), while a report is unhealthy (follow-up every
 * 30 s: public probes of a side that is down, three checks after a failure or a passing error), and at each tick
 * (version moved, report older than 24 h, see `tickOne`). One check at a time per instance.
 */
export class CompatService {
  private readonly reports = new Map<string, CompatReport>();
  private readonly running = new Map<string, Promise<CompatReport>>();
  /** The check asked while another one runs: starts when it ends, shared by every request made meanwhile. */
  private readonly queued = new Map<string, Promise<CompatReport>>();
  private readonly follows = new Map<string, Follow>();
  /** Instances whose last full check failed. */
  private readonly failed = new Set<string>();
  private readonly lastRequest = new Map<string, Partial<Record<Group, number>>>();
  private readonly observers = new Map<string, HermesObserver>();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly store: InstanceStore,
    private readonly notifier: Notifier,
    private readonly fetchImpl?: FetchLike,
    /** WebSocket of the dashboard (tests: the fake's). */
    readonly wsFactory?: WsFactory,
  ) {
    for (const inst of store.list()) {
      const row = db.select().from(compatReports).where(eq(compatReports.instanceId, inst.id))
        .orderBy(desc(compatReports.createdAt)).limit(1).get();
      if (!row) continue;
      let report: CompatReport;
      try {
        report = JSON.parse(row.reportJson) as CompatReport;
        if (!report || typeof report !== 'object' || !Array.isArray(report.modules)) throw new Error('not a report');
      } catch {
        console.warn(`[intendia] stored compat report of "${inst.id}" unreadable, ignored`);
        continue;
      }
      delete report.checkError;
      delete report.checking;
      const unchecked = uncheckedOps(report);
      if (unchecked.length > 0) report.unchecked = unchecked;
      else delete report.unchecked;
      this.reports.set(inst.id, report);
    }
  }

  /** A client of the instance with its current settings, whose failures are runtime signals (see `signal`). */
  http(instanceId: string): HermesHttp {
    const inst = this.store.get(instanceId);
    if (!inst) throw new Error(`Unknown instance "${instanceId}"`);
    return new HermesHttp(inst, this.fetchImpl, this.observer(instanceId));
  }

  get(instanceId: string): CompatReport | undefined {
    return this.reports.get(instanceId);
  }

  all(): CompatReport[] {
    return this.store.list().map((i) => {
      const r = this.reports.get(i.id);
      return r && this.running.has(i.id) ? { ...r, checking: true } : r;
    }).filter((r): r is CompatReport => Boolean(r));
  }

  /**
   * Full check of one instance, always one started after this call: with a check running, the next one starts when it
   * ends, once, shared by every request made meanwhile.
   */
  check(instanceId: string): Promise<CompatReport> {
    const queued = this.queued.get(instanceId);
    if (queued) return queued;
    const running = this.running.get(instanceId);
    if (!running) return this.begin(instanceId);
    const next = running.then(noop, noop).then(() => {
      this.queued.delete(instanceId);
      return this.begin(instanceId);
    });
    this.queued.set(instanceId, next);
    return next;
  }

  private begin(instanceId: string): Promise<CompatReport> {
    const task = (async () => {
      try {
        const report = await this.runCheck(instanceId);
        this.failed.delete(instanceId);
        return report;
      } catch (err) {
        const message = String((err as Error)?.message ?? err).slice(0, 200);
        console.warn(`[intendia] compat check of instance "${instanceId}" failed: ${message}`);
        const prev = this.reports.get(instanceId);
        if (prev) prev.checkError = message;
        this.failed.add(instanceId);
        throw err;
      } finally {
        this.running.delete(instanceId);
        this.settle(instanceId);
      }
    })();
    this.running.set(instanceId, task);
    return task;
  }

  private async runCheck(instanceId: string): Promise<CompatReport> {
    const inst = this.store.get(instanceId);
    if (!inst) throw new Error(`Unknown instance "${instanceId}"`);
    // no observer: a check must never trigger another one
    const http = new HermesHttp(inst, this.fetchImpl);
    const { report } = await checkInstance(http);
    await withFilesRoot(http, report);
    // a refused token would only make the three socket probes wait for their timeout
    if (report.dash.reachable && report.dash.auth !== 'refused') report.socket = await probeSocket(inst, { factory: this.wsFactory });
    // removed meanwhile: nothing kept
    if (!this.store.get(instanceId)) return report;
    const prev = this.reports.get(instanceId);
    if (report.outage && prev?.outage) report.outage.since = prev.outage.since;
    const before = prev?.files?.workspaceRoot;
    if (prev?.files && before !== report.files?.workspaceRoot) {
      console.warn(`[intendia] instance "${instanceId}": workspace root ${before ?? '(none)'} -> ${report.files?.workspaceRoot ?? '(none)'}`);
    }
    this.reports.set(instanceId, report);
    this.persist(report);
    const changes = stateChanges(prev, report);
    if (changes.length > 0) await this.notifier.moduleStates(report, changes);
    return report;
  }

  async checkAll(): Promise<CompatReport[]> {
    const results = await Promise.allSettled(this.store.list().map((i) => this.check(i.id)));
    return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  }

  forget(instanceId: string): void {
    this.reports.delete(instanceId);
    this.failed.delete(instanceId);
    this.lastRequest.delete(instanceId);
    this.observers.delete(instanceId);
    this.dropFollow(instanceId);
  }

  // ---------------------------------------------------------------- runtime signals

  private observer(instanceId: string): HermesObserver {
    let o = this.observers.get(instanceId);
    if (!o) {
      o = { onError: (err) => this.signal(instanceId, err) };
      this.observers.set(instanceId, o);
    }
    return o;
  }

  /** A failure seen by a client of `http(id)`. Business 404s and 403s (missing session, path outside the root) are not signals. */
  private signal(instanceId: string, err: HermesError): void {
    if (isTransient(err)) this.request(instanceId, 'down');
    else if (err.kind === 'http' && err.detail.status === 401) this.request(instanceId, 'auth');
    else if (err.kind === 'http' && err.detail.status === 404 && isMissingRoute(err.detail.body)) this.request(instanceId, 'shape');
    else if (err.kind === 'schema') this.request(instanceId, 'shape');
  }

  private request(instanceId: string, group: Group): void {
    if (this.stopped || !this.store.get(instanceId)) return;
    const last = this.lastRequest.get(instanceId) ?? {};
    const now = Date.now();
    const at = last[group];
    if (at !== undefined && now - at < DEBOUNCE_MS[group]) return;
    last[group] = now;
    this.lastRequest.set(instanceId, last);
    console.warn(`[intendia] instance "${instanceId}": recheck (${group})`);
    void this.check(instanceId).catch(noop);
  }

  // ---------------------------------------------------------------- follow-up of an unhealthy report

  private followed(instanceId: string): Cause[] {
    return causes(this.reports.get(instanceId), this.failed.has(instanceId)).filter((c) => FOLLOWED.has(c));
  }

  /** End of every full check: starts, resets or ends the follow-up. */
  private settle(instanceId: string): void {
    if (!this.store.get(instanceId)) {
      // removed while its check ran
      this.failed.delete(instanceId);
      this.dropFollow(instanceId);
      return;
    }
    const followed = this.followed(instanceId);
    if (this.stopped || followed.length === 0) {
      this.dropFollow(instanceId);
      return;
    }
    const key = followed.join(',');
    const f = this.follows.get(instanceId);
    if (!f) {
      const created: Follow = { checks: 0, causes: key, probeOk: { api: false, dash: false }, busy: false };
      this.follows.set(instanceId, created);
      this.arm(instanceId, created);
      return;
    }
    if (f.causes === key) return;
    f.causes = key;
    f.checks = 0;
    f.probeOk = { api: false, dash: false };
    // a spent follow-up starts again; a running step re-arms by itself
    if (!f.timer && !f.busy) this.arm(instanceId, f);
  }

  private arm(instanceId: string, f: Follow): void {
    clearTimeout(f.timer);
    f.timer = setTimeout(() => void this.step(instanceId, f), FOLLOW_MS);
    f.timer.unref();
  }

  private dropFollow(instanceId: string): void {
    const f = this.follows.get(instanceId);
    if (f) clearTimeout(f.timer);
    this.follows.delete(instanceId);
  }

  private async step(instanceId: string, f: Follow): Promise<void> {
    f.timer = undefined;
    if (this.follows.get(instanceId) !== f) return;
    if (!this.store.get(instanceId)) {
      this.dropFollow(instanceId);
      return;
    }
    f.busy = true;
    try {
      const now = causes(this.reports.get(instanceId), this.failed.has(instanceId));
      if (f.checks < FOLLOW_CHECKS && now.some((c) => RETRIED.has(c))) {
        f.checks += 1;
        await this.check(instanceId).catch(noop);
      } else {
        let recheck = false;
        for (const side of SIDES) {
          if (!now.includes(`${side}-down`)) continue;
          const ok = await this.probe(instanceId, side);
          if (this.follows.get(instanceId) !== f) return;
          // only the move from failing to answering starts a check (a probe that keeps answering does not)
          if (ok && !f.probeOk[side]) recheck = true;
          f.probeOk[side] = ok;
        }
        if (recheck) await this.check(instanceId).catch(noop);
      }
    } finally {
      f.busy = false;
    }
    if (this.follows.get(instanceId) !== f || this.stopped) return;
    const after = causes(this.reports.get(instanceId), this.failed.has(instanceId));
    const down = after.includes('api-down') || after.includes('dash-down');
    if (down || (f.checks < FOLLOW_CHECKS && after.some((c) => RETRIED.has(c)))) this.arm(instanceId, f);
    // else: spent, kept without timer until the causes change (settle)
  }

  /** Public liveness probe of one side (`GET /health`, `GET /api/health`): no token, no observer, 5 s. */
  private async probe(instanceId: string, side: Via): Promise<boolean> {
    const inst = this.store.get(instanceId);
    if (!inst) return false;
    try {
      await new HermesHttp(inst, this.fetchImpl).json(side, 'GET', side === 'api' ? '/health' : '/api/health', { anonymous: true, timeoutMs: PROBE_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }

  /** Authenticated read of a side whose key or token was refused (`GET /v1/capabilities`, `GET /api/profiles`). */
  private async authProbe(instanceId: string, side: Via): Promise<boolean> {
    const inst = this.store.get(instanceId);
    if (!inst) return false;
    try {
      await new HermesHttp(inst, this.fetchImpl).json(side, 'GET', side === 'api' ? '/v1/capabilities' : '/api/profiles', { timeoutMs: PROBE_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- tick

  /** Every instance in parallel; skipped while the previous tick runs. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await Promise.allSettled(this.store.list().map((i) => this.tickOne(i.id)));
    } finally {
      this.ticking = false;
    }
  }

  /** The first rule that matches (see docs/architecture.md, "Compatibility"). */
  private async tickOne(instanceId: string): Promise<void> {
    // a check already runs: its report is fresh
    if (this.running.has(instanceId)) return;
    const recheck = () => this.check(instanceId).then(noop, noop);
    const prev = this.reports.get(instanceId);
    // 1. never checked, unknown ops, failed, saved before the files root existed, or older than 24 h
    if (!prev || prev.unchecked?.length || this.failed.has(instanceId) || prev.checkError || !prev.files || Date.now() - prev.checkedAt > DAY_MS) {
      return recheck();
    }
    const now = causes(prev, false);
    // 2. a side down: its public probe
    const down = SIDES.filter((s) => now.includes(`${s}-down`));
    if (down.length) {
      for (const side of down) if (await this.probe(instanceId, side)) return recheck();
      return;
    }
    // 3. a passing error
    if (now.includes('transient')) return recheck();
    // 4. a refused key or token: one authenticated read
    const refused = SIDES.filter((s) => now.includes(`${s}-refused`));
    if (refused.length) {
      for (const side of refused) if (await this.authProbe(instanceId, side)) return recheck();
      return;
    }
    // 5. API server unreachable for another reason (as before)
    if (!prev.api.reachable) return recheck();
    // 6. no files root: the user may have fixed it
    if (now.includes('no-root') && Date.now() - prev.checkedAt > NO_ROOT_RETRY_MS) return recheck();
    // 7. the version announced by /health/detailed
    try {
      const health = (await new HermesHttp(this.store.get(instanceId)!, this.fetchImpl).json('api', 'GET', '/health/detailed')) as { version?: unknown };
      if (typeof health?.version === 'string' && health.version !== prev.hermesVersion) return recheck();
    } catch {
      return recheck();
    }
  }

  start(intervalMinutes: number): void {
    this.stopped = false;
    void this.checkAll();
    this.timer = setInterval(() => void this.tick(), intervalMinutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.follows.keys()]) this.dropFollow(id);
  }

  private persist(report: CompatReport): void {
    this.db.insert(compatReports).values({
      instanceId: report.instanceId,
      hermesVersion: report.hermesVersion,
      reportJson: JSON.stringify(report),
      createdAt: report.checkedAt,
    }).run();
    const old = this.db.select({ id: compatReports.id }).from(compatReports)
      .where(eq(compatReports.instanceId, report.instanceId))
      .orderBy(desc(compatReports.createdAt)).all().slice(KEEP_REPORTS);
    for (const o of old) this.db.delete(compatReports).where(eq(compatReports.id, o.id)).run();
  }
}
