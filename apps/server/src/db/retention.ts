import type { Db } from './index.js';
import { log as journal } from '../log.js';

const DAY_MS = 86_400_000;
const EVERY_MS = 6 * 3_600_000;
/** Closed turns of a channel: the last ones stay whatever their age (the channel's page shows 50). */
const TURNS_KEPT = 50;
const TURN_DAYS = 30;
/** Runs of a session that no longer exists (deleted, or its instance removed). */
const ORPHAN_RUN_DAYS = 30;
/** A revoked link answers « Lien révoqué » for this long, then « Lien inconnu ». */
const REVOKED_LINK_DAYS = 90;

export interface RetentionResult { sessions: number; turns: number; runs: number; links: number }

/**
 * Rows nothing reads any more, deleted every 6 hours (the tables only grew): expired sign-in sessions, old closed
 * turns of the channels, costs of sessions that are gone, links revoked long ago. Never a message, a live session's
 * cost or a link that can still be opened or extended.
 */
export class Retention {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly db: Db, private readonly log: (line: string) => void = (l) => journal.error(l)) {}

  sweep(now = Date.now()): RetentionResult {
    const run = (sql: string, ...args: (number | string)[]) => this.db.$client.prepare(sql).run(...args).changes;
    this.running = true;
    try {
      return {
        sessions: run('DELETE FROM auth_sessions WHERE expires_at < ?', now),
        turns: run(
          `DELETE FROM channel_turns WHERE status IN ('done', 'cancelled') AND created_at < ?
             AND id NOT IN (SELECT t.id FROM channel_turns t WHERE t.channel_id = channel_turns.channel_id ORDER BY t.id DESC LIMIT ${TURNS_KEPT})`,
          now - TURN_DAYS * DAY_MS,
        ),
        runs: run(
          `DELETE FROM run_stats WHERE status != 'running' AND started_at < ?
             AND NOT EXISTS (SELECT 1 FROM session_workspace s WHERE s.instance_id = run_stats.instance_id AND s.session_id = run_stats.session_id)
             AND NOT EXISTS (SELECT 1 FROM channel_members m WHERE m.instance_id = run_stats.instance_id AND m.session_id = run_stats.session_id)`,
          now - ORPHAN_RUN_DAYS * DAY_MS,
        ),
        links: run('DELETE FROM share_links WHERE revoked = 1 AND created_at < ?', now - REVOKED_LINK_DAYS * DAY_MS),
      };
    } finally {
      this.running = false;
    }
  }

  private pass(): void {
    try {
      const r = this.sweep();
      const total = r.sessions + r.turns + r.runs + r.links;
      if (total > 0) this.log(`[intendia] retention: ${r.sessions} sign-in sessions, ${r.turns} channel turns, ${r.runs} runs, ${r.links} links deleted`);
    } catch (err) {
      this.log(`[intendia] retention: ${(err as Error).message}`);
    }
  }

  start(): void {
    if (this.timer) return;
    this.pass();
    this.timer = setInterval(() => this.pass(), EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get idle(): boolean {
    return !this.running;
  }
}
