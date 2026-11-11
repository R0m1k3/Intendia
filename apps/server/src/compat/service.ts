import { desc, eq } from 'drizzle-orm';
import type { CompatReport } from '../connectors/types.js';
import type { Db } from '../db/index.js';
import { compatReports } from '../db/schema.js';
import { HermesHttp, type FetchLike } from '../hermes/http.js';
import type { InstanceStore } from '../instances/store.js';
import { checkInstance, stateChanges } from './engine.js';
import { withFilesRoot } from './files-root.js';
import type { Notifier } from './notify.js';

const KEEP_REPORTS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_ROOT_RETRY_MS = 15 * 60 * 1000;

/**
 * Keeps one compatibility report per instance. Reruns the full check at boot, when the
 * Hermes version announced by /health/detailed changes, every 24 h, and on demand.
 */
export class CompatService {
  private readonly reports = new Map<string, CompatReport>();
  private readonly running = new Map<string, Promise<CompatReport>>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Db,
    private readonly store: InstanceStore,
    private readonly notifier: Notifier,
    private readonly fetchImpl?: FetchLike,
  ) {
    for (const inst of store.list()) {
      const row = db.select().from(compatReports).where(eq(compatReports.instanceId, inst.id))
        .orderBy(desc(compatReports.createdAt)).limit(1).get();
      if (row) this.reports.set(inst.id, JSON.parse(row.reportJson) as CompatReport);
    }
  }

  http(instanceId: string): HermesHttp {
    const inst = this.store.get(instanceId);
    if (!inst) throw new Error(`Unknown instance "${instanceId}"`);
    return new HermesHttp(inst, this.fetchImpl);
  }

  get(instanceId: string): CompatReport | undefined {
    return this.reports.get(instanceId);
  }

  all(): CompatReport[] {
    return this.store.list().map((i) => this.reports.get(i.id)).filter((r): r is CompatReport => Boolean(r));
  }

  /** Runs (or joins the running) full check of one instance. */
  check(instanceId: string): Promise<CompatReport> {
    const existing = this.running.get(instanceId);
    if (existing) return existing;
    const task = (async () => {
      const http = this.http(instanceId);
      const { report } = await checkInstance(http);
      await withFilesRoot(http, report);
      const prev = this.reports.get(instanceId);
      const before = prev?.files?.workspaceRoot;
      if (prev?.files && before !== report.files?.workspaceRoot) {
        console.warn(`[intendia] instance "${instanceId}": workspace root ${before ?? '(none)'} -> ${report.files?.workspaceRoot ?? '(none)'}`);
      }
      this.reports.set(instanceId, report);
      this.persist(report);
      const changes = stateChanges(prev, report);
      if (changes.length > 0) await this.notifier.moduleStates(report, changes);
      return report;
    })().finally(() => this.running.delete(instanceId));
    this.running.set(instanceId, task);
    return task;
  }

  async checkAll(): Promise<CompatReport[]> {
    const results = await Promise.allSettled(this.store.list().map((i) => this.check(i.id)));
    return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  }

  forget(instanceId: string): void {
    this.reports.delete(instanceId);
  }

  /** Cheap check: only /health/detailed. Full recheck if the version moved or the report is old. */
  async tick(): Promise<void> {
    for (const inst of this.store.list()) {
      const prev = this.reports.get(inst.id);
      // a report saved before the files root existed counts as not checked
      if (!prev || !prev.files || Date.now() - prev.checkedAt > DAY_MS || !prev.api.reachable) {
        await this.check(inst.id).catch(() => undefined);
        continue;
      }
      try {
        const health = (await this.http(inst.id).json('api', 'GET', '/health/detailed')) as { version?: unknown };
        if (typeof health?.version === 'string' && health.version !== prev.hermesVersion) await this.check(inst.id);
      } catch {
        await this.check(inst.id).catch(() => undefined);
      }
    }
  }

  start(intervalMinutes: number): void {
    void this.checkAll();
    this.timer = setInterval(() => void this.tick(), intervalMinutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
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
