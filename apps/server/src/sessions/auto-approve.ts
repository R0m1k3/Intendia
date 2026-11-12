// « Sans confirmation »: Hermes has no per-session setting for it, so Intendia answers « once » to each approval of the
// runs of the sessions where it is on. One pass every 2 s, one at a time, over the runs ActivityService already
// follows (sessions active in the last 24 h). A server restart picks up at the next pass. Questions of the agent
// (clarify) are never answered.
import type { ActivityService } from '../agents/activity.js';
import { pendingFromStatus, readApproval } from '../agents/approvals.js';
import { answerApproval } from '../chat/approve.js';
import type { CompatService } from '../compat/service.js';
import type { SessionContext, WorkspaceService } from '../workspaces/service.js';

const EVERY_MS = 2_000;

export class AutoApprover {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly activity: ActivityService,
    private readonly compat: CompatService,
    private readonly log: (line: string) => void = (l) => console.error(l),
  ) {}

  /** One pass; returns the runs approved (`<instance>/<run>`). */
  async pass(now = Date.now()): Promise<string[]> {
    const approved: string[] = [];
    if (this.busy) return approved;
    this.busy = true;
    try {
      const runs = await this.activity.autoApproveRuns(now, (inst, err) => this.log(`[intendia] sans confirmation ${inst}: ${(err as Error).message}`));
      for (const r of runs) {
        if (r.status !== 'waiting_for_approval') continue;
        let ctx: SessionContext;
        try {
          ctx = this.workspaces.getSession(r.instance, r.sessionId);
        } catch {
          continue; // deleted meanwhile
        }
        if (!ctx.session.autoApprove || ctx.session.lastRunId !== r.runId) continue;
        const key = `${r.instance}/${r.runId}`;
        try {
          const q = pendingFromStatus(r.runId, r.controls) ?? await readApproval(this.compat, r.instance, r.runId, ctx.profile);
          if (q?.kind !== 'approval') continue;
          await answerApproval(this.compat, ctx, r.runId, 'once', q.requestId);
          this.workspaces.addAutoApproved(r.instance, r.runId);
          approved.push(key);
          this.log(`[intendia] sans confirmation : ${key} approuvé (${(q.command ?? q.description ?? 'action').slice(0, 120)})`);
        } catch (err) {
          // answered by hand in the same second, run over, Hermes down: the next pass sees what is left
          this.log(`[intendia] sans confirmation ${key}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.busy = false;
    }
    return approved;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pass().catch((err) => this.log(`[intendia] sans confirmation: ${(err as Error).message}`)), EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
