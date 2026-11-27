// Channels with several agents (OpenBot-like, lot 7): a thread kept by Intendia, its members are agents of one or
// several Hermes instances. Each member has a hidden Intendia session (archived, titled « Canal « … » · @handle »: its
// approvals show in « Vous attend » with the channel's name). Messages and turns live in the database; the runner
// (channels/runner.ts) plays the turns one at a time per channel.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, max } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { channelMembers, channelMessages, channels, channelTurns } from '../db/schema.js';
import { msg } from '../i18n/index.js';
import type { InstanceStore } from '../instances/store.js';
import { NotFoundError, ValidationError, type WorkspaceService } from '../workspaces/service.js';
import { handlesFor, mentions } from './text.js';

export type ChannelRow = typeof channels.$inferSelect;
export type MemberRow = typeof channelMembers.$inferSelect;
export type MessageRow = typeof channelMessages.$inferSelect;
export type TurnRow = typeof channelTurns.$inferSelect;
export type TurnStatus = 'queued' | 'running' | 'done' | 'stopped' | 'cancelled';

export const OPEN: TurnStatus[] = ['queued', 'running', 'stopped'];

export class ChannelService {
  constructor(private readonly db: Db, private readonly store: InstanceStore, private readonly workspaces: WorkspaceService) {}

  list(): (ChannelRow & { members: MemberRow[]; lastAt: number; busy: boolean; stopped: boolean })[] {
    const rows = this.db.select().from(channels).where(eq(channels.archived, false)).all();
    return rows.map((ch) => {
      const last = this.db.select({ at: max(channelMessages.createdAt) }).from(channelMessages).where(eq(channelMessages.channelId, ch.id)).get()?.at;
      const open = this.openTurns(ch.id);
      return {
        ...ch, members: this.members(ch.id), lastAt: last ?? ch.createdAt,
        busy: open.some((t) => t.status !== 'stopped'), stopped: open.some((t) => t.status === 'stopped'),
      };
    }).sort((a, b) => b.lastAt - a.lastAt);
  }

  get(id: string): ChannelRow {
    const ch = this.db.select().from(channels).where(and(eq(channels.id, id), eq(channels.archived, false))).get();
    if (!ch) throw new NotFoundError(msg('Canal inconnu : {id}', { id }));
    return ch;
  }

  members(id: string): MemberRow[] {
    return this.db.select().from(channelMembers).where(eq(channelMembers.channelId, id)).all();
  }

  messages(id: string, after = 0): MessageRow[] {
    return this.db.select().from(channelMessages)
      .where(and(eq(channelMessages.channelId, id), gt(channelMessages.seq, after))).orderBy(asc(channelMessages.seq)).all();
  }

  turns(id: string, limit = 50): TurnRow[] {
    return this.db.select().from(channelTurns).where(eq(channelTurns.channelId, id)).orderBy(desc(channelTurns.id)).limit(limit).all().reverse();
  }

  openTurns(id: string): TurnRow[] {
    return this.db.select().from(channelTurns)
      .where(and(eq(channelTurns.channelId, id), inArray(channelTurns.status, OPEN))).orderBy(asc(channelTurns.id)).all();
  }

  /** Channels with a turn to play or to follow (the runner's work). */
  active(): ChannelRow[] {
    const ids = [...new Set(this.db.select({ id: channelTurns.channelId }).from(channelTurns)
      .where(inArray(channelTurns.status, ['queued', 'running'])).all().map((r) => r.id))];
    return ids.length ? this.db.select().from(channels).where(and(inArray(channels.id, ids), eq(channels.archived, false))).all() : [];
  }

  /**
   * A new channel: each member gets a hidden session in a folder of its instance (its agent's own folder first, else
   * the instance's first one, the session then set to the agent).
   */
  async create(input: { name: string; instructions: string; lead: number; members: { instanceId: string; profile: string }[] }): Promise<ChannelRow> {
    const seen = new Set<string>();
    for (const m of input.members) {
      const k = `${m.instanceId}\n${m.profile}`;
      if (seen.has(k)) throw new ValidationError(msg('Un agent figure deux fois dans le canal'));
      seen.add(k);
      if (!this.store.get(m.instanceId)) throw new ValidationError(msg('Instance inconnue : {id}', { id: m.instanceId }));
    }
    if (!input.members[input.lead]) throw new ValidationError(msg('Le chef doit être un membre du canal'));
    const handles = handlesFor(input.members);
    // folders first: nothing is created when one instance has none
    const all = this.workspaces.listWorkspaces();
    const folders = input.members.map((m) => {
      const own = all.filter((w) => w.instanceId === m.instanceId);
      const ws = own.find((w) => (w.profile ?? 'default') === m.profile) ?? own[0];
      if (!ws) throw new ValidationError(msg('Aucun dossier sur {instance} : créez-en un d’abord', { instance: this.store.get(m.instanceId)?.label ?? m.instanceId }));
      return ws;
    });
    const id = `ch-${randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const rows: MemberRow[] = [];
    for (const [i, m] of input.members.entries()) {
      const ws = folders[i]!;
      const s = await this.workspaces.createSession(ws.slug);
      this.workspaces.updateSession(m.instanceId, s.id, {
        title: `Canal « ${input.name} » · @${handles[i]}`, archived: true,
        ...((ws.profile ?? 'default') !== m.profile ? { profile: m.profile } : {}),
      });
      rows.push({ channelId: id, handle: handles[i]!, instanceId: m.instanceId, profile: m.profile, sessionId: s.id, seenSeq: 0 });
    }
    this.db.transaction((tx) => {
      tx.insert(channels).values({ id, name: input.name, instructions: input.instructions, lead: handles[input.lead]!, archived: false, createdAt: now }).run();
      for (const r of rows) tx.insert(channelMembers).values(r).run();
    });
    return this.get(id);
  }

  update(id: string, patch: { name?: string; instructions?: string; lead?: string }): ChannelRow {
    this.get(id);
    if (patch.lead !== undefined && !this.members(id).some((m) => m.handle === patch.lead)) throw new ValidationError(msg('Le chef doit être un membre du canal'));
    this.db.update(channels).set(patch).where(eq(channels.id, id)).run();
    return this.get(id);
  }

  /** Archived: its turns are dropped, its hidden sessions stay (archived) at Hermes. */
  archive(id: string): void {
    this.get(id);
    this.db.transaction((tx) => {
      tx.update(channels).set({ archived: true }).where(eq(channels.id, id)).run();
      tx.update(channelTurns).set({ status: 'cancelled' }).where(and(eq(channelTurns.channelId, id), inArray(channelTurns.status, OPEN))).run();
    });
  }

  append(id: string, author: string, text: string, runId: string | null = null, now = Date.now()): MessageRow {
    return this.db.transaction((tx) => {
      const seq = (tx.select({ s: max(channelMessages.seq) }).from(channelMessages).where(eq(channelMessages.channelId, id)).get()?.s ?? 0) + 1;
      const row = { channelId: id, seq, author, text, runId, createdAt: now };
      tx.insert(channelMessages).values(row).run();
      return row;
    });
  }

  enqueue(id: string, handle: string, chain: number, now = Date.now()): void {
    // one waiting turn per member: it will read every message unseen anyway
    if (this.openTurns(id).some((t) => t.handle === handle && t.status === 'queued')) return;
    this.db.insert(channelTurns).values({ channelId: id, handle, status: 'queued', chain, runId: null, detail: null, attempt: 0, createdAt: now }).run();
  }

  /**
   * A message of the user: the members it names (@handle, @tous) take a turn, else the lead. A new message starts
   * a new chain of relays.
   */
  post(id: string, text: string): MessageRow {
    const ch = this.get(id);
    const handles = this.members(id).map((m) => m.handle);
    const row = this.append(id, 'user', text);
    const named = mentions(text, handles);
    for (const h of named.length ? named : [ch.lead]) this.enqueue(id, h, 0);
    return row;
  }

  setTurn(turnId: number, set: Partial<Pick<TurnRow, 'status' | 'runId' | 'detail' | 'attempt'>>): void {
    this.db.update(channelTurns).set(set).where(eq(channelTurns.id, turnId)).run();
  }

  seen(id: string, handle: string, seq: number): void {
    this.db.update(channelMembers).set({ seenSeq: seq }).where(and(eq(channelMembers.channelId, id), eq(channelMembers.handle, handle))).run();
  }

  turn(id: string, turnId: number): TurnRow {
    const t = this.db.select().from(channelTurns).where(and(eq(channelTurns.channelId, id), eq(channelTurns.id, turnId))).get();
    if (!t) throw new NotFoundError(msg('Tour inconnu : {id}', { id: turnId }));
    return t;
  }

  /** A stopped turn: played again by the same member, given to another one, or dropped. */
  resolve(id: string, turnId: number, action: { kind: 'continue' } | { kind: 'reassign'; handle: string } | { kind: 'cancel' }): void {
    const t = this.turn(id, turnId);
    if (t.status !== 'stopped' && t.status !== 'queued') throw new ValidationError(msg('Ce tour n’attend pas de décision'));
    if (action.kind === 'continue') { this.setTurn(turnId, { status: 'queued', detail: null, runId: null, attempt: t.attempt + 1 }); return; }
    this.setTurn(turnId, { status: 'cancelled' });
    if (action.kind === 'reassign') {
      if (!this.members(id).some((m) => m.handle === action.handle)) throw new ValidationError(msg('Membre inconnu : {handle}', { handle: action.handle }));
      this.append(id, 'system', msg('Tâche confiée à @{to} à la place de @{from}', { to: action.handle, from: t.handle }));
      this.enqueue(id, action.handle, t.chain);
    } else this.append(id, 'system', msg('Tour de @{handle} annulé', { handle: t.handle }));
  }

  /** Cost of the channel: the runs of its hidden sessions (null when none is priced yet). */
  cost(id: string): { usd: number; unpriced: number } {
    let usd = 0;
    let unpriced = 0;
    for (const m of this.members(id)) {
      for (const r of this.workspaces.runStats(m.instanceId, m.sessionId)) {
        if (r.costUsd == null) unpriced += 1; else usd += r.costUsd;
      }
    }
    return { usd, unpriced };
  }
}
