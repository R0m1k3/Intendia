// Plays the turns of the channels (channels/service.ts), like the goal loop: every 3 s, one pass at a time, on the
// server (tabs closed, after a restart: the state is in the database). One turn at a time per channel: the running
// turn is followed until its run ends (its answer goes into the channel, the members it names take a turn, 5 relays at
// most), else the next queued one starts with the messages its member has not seen. A run that fails or stops leaves
// the turn « stopped »: the user continues, reassigns or cancels it.
import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { readRunStatus } from '../chat/history.js';
import { RunBusyError, settle, startRun, type StartRunDeps } from '../chat/start-run.js';
import { msg } from '../i18n/index.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError } from '../workspaces/service.js';
import type { ChannelRow, ChannelService, TurnRow } from './service.js';
import { MAX_CHAIN, mentions, turnInput } from './text.js';

const EVERY_MS = 3_000;
const START_TRIES = 3;

export class ChannelRunner {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly failures = new Map<number, number>();

  constructor(
    private readonly deps: StartRunDeps & { channels: ChannelService; store: InstanceStore },
    private readonly log: (line: string) => void = (l) => console.error(l),
  ) {}

  async pass(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const ch of this.deps.channels.active()) {
        try {
          await this.step(ch);
        } catch (err) {
          this.log(`[intendia] canal ${ch.id} : ${(err as Error).message}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async step(ch: ChannelRow): Promise<void> {
    const { channels } = this.deps;
    const open = channels.openTurns(ch.id);
    const running = open.find((t) => t.status === 'running');
    await this.settleCosts(ch, running?.handle);
    if (running) { await this.follow(ch, running); return; }
    // a stopped turn waits for the user's decision before anything else
    if (open.some((t) => t.status === 'stopped')) return;
    const next = open.find((t) => t.status === 'queued');
    if (next) await this.begin(ch, next);
  }

  private member(ch: ChannelRow, handle: string) {
    return this.deps.channels.members(ch.id).find((m) => m.handle === handle) ?? null;
  }

  /**
   * Records the end and the cost of the hidden sessions' runs (nobody opens them, so the chat routes never do):
   * until each last run's cost is final, else the channel's cost would stay unknown. The running turn's member is
   * left to follow().
   */
  private async settleOne(ch: ChannelRow, m: { handle: string; instanceId: string; sessionId: string }): Promise<void> {
    try {
      await settle(this.deps, this.deps.workspaces.getSession(m.instanceId, m.sessionId));
    } catch (err) {
      if (!(err instanceof NotFoundError)) this.log(`[intendia] canal ${ch.id} : coût de @${m.handle} : ${(err as Error).message}`);
    }
  }

  private async settleCosts(ch: ChannelRow, skip?: string): Promise<void> {
    for (const m of this.deps.channels.members(ch.id)) {
      if (m.handle === skip) continue;
      const tail = this.deps.workspaces.runStats(m.instanceId, m.sessionId).at(-1);
      if (!tail || tail.costFinal || tail.status === 'unknown') continue;
      await this.settleOne(ch, m);
    }
  }

  private halt(ch: ChannelRow, t: TurnRow, detail: string): void {
    this.deps.channels.setTurn(t.id, { status: 'stopped', detail });
    this.log(`[intendia] canal ${ch.id} : tour de @${t.handle} arrêté (${detail.slice(0, 120)})`);
  }

  private async begin(ch: ChannelRow, t: TurnRow): Promise<void> {
    const { channels, workspaces } = this.deps;
    const m = this.member(ch, t.handle);
    if (!m) { channels.setTurn(t.id, { status: 'cancelled', detail: 'membre retiré' }); return; }
    let ctx;
    try {
      ctx = workspaces.getSession(m.instanceId, m.sessionId);
    } catch (err) {
      if (err instanceof NotFoundError) { this.halt(ch, t, msg('La session cachée de @{handle} n’existe plus', { handle: t.handle })); return; }
      throw err;
    }
    // its own answers are not sent back to it, but count as seen
    const since = channels.messages(ch.id, m.seenSeq);
    const unseen = since.filter((x) => x.author !== m.handle);
    const members = channels.members(ch.id).map((x) => ({ handle: x.handle, profile: x.profile, instanceLabel: this.deps.store.get(x.instanceId)?.label ?? x.instanceId }));
    const input = turnInput({ channel: ch, members, me: m.handle, messages: unseen.length ? unseen : [{ seq: 0, author: 'system', text: msg('Reprenez où vous en étiez.') }] });
    try {
      // the turn's id gives the key: the same turn started twice (a restart) is one run at Hermes
      const { runId } = await startRun(this.deps, ctx, input, { keySuffix: `canal-${ch.id}-${t.id}-${t.attempt}` });
      channels.setTurn(t.id, { status: 'running', runId, detail: null });
      // the watermark of what was sent: a message posted during the run stays unseen for the member's next turn
      const last = since.at(-1)?.seq;
      if (last) channels.seen(ch.id, m.handle, last);
      this.failures.delete(t.id);
    } catch (err) {
      // the hidden session is busy (opened by hand?): next pass
      if (err instanceof RunBusyError) return;
      const tries = (this.failures.get(t.id) ?? 0) + 1;
      this.failures.set(t.id, tries);
      if (tries >= START_TRIES) { this.failures.delete(t.id); this.halt(ch, t, (err as Error).message); return; }
      throw err;
    }
  }

  private async follow(ch: ChannelRow, t: TurnRow): Promise<void> {
    const { channels, compat } = this.deps;
    const m = this.member(ch, t.handle);
    if (!m || !t.runId) { channels.setTurn(t.id, { status: 'cancelled' }); return; }
    const s = await readRunStatus(compat, m.instanceId, m.profile, t.runId);
    if (s.status === 'unknown') { this.halt(ch, t, msg('Run introuvable chez Hermes')); return; }
    // running, or waiting for an approval (shown in « Vous attend ») or an answer
    if (!TERMINAL_STATUSES.includes(s.status)) return;
    if (s.status === 'failed') { this.halt(ch, t, s.error ?? msg('Le run a échoué')); return; }
    if (s.status !== 'completed') { this.halt(ch, t, msg('Le run a été arrêté')); return; }
    await this.settleOne(ch, m);
    const text = (s.output ?? '').trim() || msg('(réponse vide)');
    channels.append(ch.id, m.handle, text, t.runId);
    channels.setTurn(t.id, { status: 'done' });
    const handles = channels.members(ch.id).map((x) => x.handle);
    const named = mentions(text, handles, m.handle);
    if (!named.length) return;
    if (t.chain >= MAX_CHAIN) {
      channels.append(ch.id, 'system', msg('Relais arrêtés : {n} au plus d’affilée. Écrivez pour relancer.', { n: MAX_CHAIN }));
      return;
    }
    if (m.handle === ch.lead && t.chain === 0) {
      channels.append(ch.id, 'system', msg('@{lead} a confié la suite à {to}', { lead: m.handle, to: named.map((h) => `@${h}`).join(', ') }));
    }
    for (const h of named) channels.enqueue(ch.id, h, t.chain + 1);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pass().catch((err) => this.log(`[intendia] canaux : ${(err as Error).message}`)), EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
