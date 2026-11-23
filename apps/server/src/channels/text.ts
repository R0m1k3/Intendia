// Channels with several agents: the pure parts (who is named, what a member receives on its turn). Tested in
// test/channels-text.test.ts.

export interface MemberRef { handle: string; profile: string; instanceLabel: string }
export interface ChannelMessage { seq: number; author: string; text: string }

/** At most this many relays (an agent waking another) after a message of the user, as `delegation_wakes`. */
export const MAX_CHAIN = 5;

/** Handles: the profile, with the instance's id when two members share it (« default », « default-maison »). */
export function handlesFor(members: readonly { instanceId: string; profile: string }[]): string[] {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
  const shared = (p: string) => members.filter((m) => m.profile === p).length > 1;
  const out: string[] = [];
  for (const m of members) {
    let h = shared(m.profile) ? `${clean(m.profile)}-${clean(m.instanceId)}` : clean(m.profile);
    for (let i = 2; out.includes(h); i += 1) h = `${h}-${i}`;
    out.push(h);
  }
  return out;
}

/**
 * The members named in a text with @handle (case-insensitive, not inside a word or an e-mail address); « @tous » /
 * « @all » names every member. In the order of the members; `except` (the author) is never named.
 */
export function mentions(text: string, handles: readonly string[], except?: string): string[] {
  const named = new Set<string>();
  const re = /(^|[^\w@.])@([\w-]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) named.add(m[2]!.toLowerCase());
  const all = named.has('tous') || named.has('all');
  return handles.filter((h) => h !== except && (all || named.has(h.toLowerCase())));
}

/** What a member receives when its turn comes: the frame of the channel, then the messages it has not seen. */
export function turnInput(o: {
  channel: { name: string; instructions: string; lead: string };
  members: readonly MemberRef[];
  me: string;
  messages: readonly ChannelMessage[];
}): string {
  const others = o.members.filter((m) => m.handle !== o.me)
    .map((m) => `@${m.handle}${m.handle === o.channel.lead ? ' (chef)' : ''}`).join(', ') || 'personne';
  const lines = [
    `[Intendia] Canal « ${o.channel.name} ». Vous y êtes @${o.me}${o.me === o.channel.lead ? ', le chef du canal' : ''}. Autres membres : ${others}.`,
    ...(o.channel.instructions.trim() ? [`Consignes du canal : ${o.channel.instructions.trim()}`] : []),
    o.me === o.channel.lead
      ? 'Quand un message ne nomme personne, c’est à vous : répondez vous-même, ou confiez la tâche à un membre en écrivant @nom dans votre réponse.'
      : 'Répondez au canal. Pour passer la main à un membre, écrivez @nom dans votre réponse ; sinon ne nommez personne.',
    '',
    'Nouveaux messages du canal :',
    ...o.messages.map((m) => `— ${m.author === 'user' ? 'Utilisateur' : m.author === 'system' ? 'Intendia' : `@${m.author}`} : ${m.text}`),
  ];
  return lines.join('\n');
}
