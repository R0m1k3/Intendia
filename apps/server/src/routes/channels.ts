// Channels with several agents (channels/): list, create, read, write, decide a stopped turn, archive.
import { Hono } from 'hono';
import { z } from 'zod';
import type { ChannelRunner } from '../channels/runner.js';
import type { ChannelService } from '../channels/service.js';
import type { InstanceStore } from '../instances/store.js';
import { readJson } from './body.js';

const Create = z.object({
  name: z.string().trim().min(1).max(60),
  instructions: z.string().trim().max(4000).default(''),
  /** index of the lead in `members` */
  lead: z.number().int().min(0),
  members: z.array(z.object({ instanceId: z.string().min(1).max(64), profile: z.string().min(1).max(64) })).min(1).max(8),
});
const Patch = z.object({ name: z.string().trim().min(1).max(60).optional(), instructions: z.string().trim().max(4000).optional(), lead: z.string().min(1).max(80).optional() });
const Post = z.object({ text: z.string().trim().min(1).max(8000) });
const Decide = z.discriminatedUnion('action', [
  z.object({ action: z.literal('continue') }), z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('reassign'), handle: z.string().min(1).max(80) }),
]);

export function channelRoutes(deps: { channels: ChannelService; runner: ChannelRunner; store: InstanceStore }): Hono {
  const { channels, runner, store } = deps;
  const r = new Hono();
  const label = (inst: string) => store.get(inst)?.label ?? inst;
  const memberView = (m: ReturnType<ChannelService['members']>[number]) => ({
    handle: m.handle, instanceId: m.instanceId, instanceLabel: label(m.instanceId), profile: m.profile, sessionId: m.sessionId,
  });
  // the runner plays the new turn now rather than at its next tick
  const kick = () => void runner.pass().catch(() => {});

  r.get('/channels', (c) => c.json({
    channels: channels.list().map((ch) => ({
      id: ch.id, name: ch.name, lead: ch.lead, lastAt: ch.lastAt, busy: ch.busy, stopped: ch.stopped, members: ch.members.map(memberView),
    })),
  }));

  r.post('/channels', async (c) => {
    const ch = await channels.create(Create.parse(await readJson(c)));
    return c.json({ channel: { id: ch.id, name: ch.name } }, 201);
  });

  r.get('/channels/:id', (c) => {
    const ch = channels.get(c.req.param('id'));
    return c.json({
      channel: { id: ch.id, name: ch.name, instructions: ch.instructions, lead: ch.lead, createdAt: ch.createdAt },
      members: channels.members(ch.id).map(memberView),
      messages: channels.messages(ch.id).map((m) => ({ seq: m.seq, author: m.author, text: m.text, at: m.createdAt })),
      turns: channels.turns(ch.id).map((t) => ({ id: t.id, handle: t.handle, status: t.status, chain: t.chain, detail: t.detail, at: t.createdAt })),
      cost: channels.cost(ch.id),
    });
  });

  r.patch('/channels/:id', async (c) => {
    const ch = channels.update(c.req.param('id'), Patch.parse(await readJson(c)));
    return c.json({ channel: { id: ch.id, name: ch.name, instructions: ch.instructions, lead: ch.lead } });
  });

  r.delete('/channels/:id', (c) => {
    channels.archive(c.req.param('id'));
    return c.json({ ok: true });
  });

  r.post('/channels/:id/messages', async (c) => {
    const row = channels.post(c.req.param('id'), Post.parse(await readJson(c)).text);
    kick();
    return c.json({ message: { seq: row.seq } }, 201);
  });

  r.post('/channels/:id/turns/:turn', async (c) => {
    const body = Decide.parse(await readJson(c));
    const turn = Number(c.req.param('turn'));
    channels.resolve(c.req.param('id'), turn, body.action === 'reassign' ? { kind: 'reassign', handle: body.handle } : { kind: body.action });
    kick();
    return c.json({ ok: true });
  });
  return r;
}
