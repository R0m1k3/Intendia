import { callOp, HermesError } from '../connectors/runtime.js';
import type { CompatService } from '../compat/service.js';
import { UNDO_MS, type WorkspaceService } from '../workspaces/service.js';

export { UNDO_MS };

const EVERY_MS = 5000;
const PER_SWEEP = 20;

/**
 * Deletes at Hermes the sessions whose undo window is over, then their rows. Hermes has no undo, so the deletion
 * waits on the server (a closed tab loses nothing). A failure keeps the row hidden; it is tried again a minute later
 * (`PURGE_RETRY_MS`), one log line per attempt.
 */
export class SessionPurger {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly compat: CompatService,
    private readonly log: (line: string) => void = (l) => console.error(l),
  ) {}

  async sweep(now = Date.now()): Promise<{ purged: string[]; failed: string[] }> {
    const purged: string[] = [];
    const failed: string[] = [];
    if (this.running) return { purged, failed };
    this.running = true;
    try {
      for (const item of this.workspaces.claimPurgeable(now, PER_SWEEP)) {
        const key = `${item.instanceId}/${item.sessionId}`;
        try {
          await callOp(this.compat.http(item.instanceId), this.compat.get(item.instanceId), 'sessions', 'remove', {
            params: { session_id: item.sessionId }, profile: item.profile,
          });
        } catch (err) {
          // never sent to Hermes (no message yet): nothing to delete there
          if (!(err instanceof HermesError && err.detail.status === 404)) {
            failed.push(item.sessionId);
            this.log(`[intendia] purge ${key}: ${(err as Error).message}`);
            continue;
          }
        }
        this.workspaces.dropRow(item.instanceId, item.sessionId);
        purged.push(item.sessionId);
      }
    } finally {
      this.running = false;
    }
    return { purged, failed };
  }

  start(): void {
    if (this.timer) return;
    void this.sweep().catch((err) => this.log(`[intendia] purge: ${(err as Error).message}`));
    this.timer = setInterval(() => void this.sweep().catch((err) => this.log(`[intendia] purge: ${(err as Error).message}`)), EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
