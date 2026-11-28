/** Channels with several agents (lot 7): a member is an agent of an instance, `handle` is its @name in the channel. */
export interface ChannelMember { handle: string; instanceId: string; instanceLabel: string; profile: string; sessionId: string }
export interface ChannelItem { id: string; name: string; lead: string; lastAt: number; busy: boolean; stopped: boolean; members: ChannelMember[] }
export interface ChannelMessage { seq: number; author: string; text: string; at: number }
export interface ChannelTurn { id: number; handle: string; status: 'queued' | 'running' | 'done' | 'stopped' | 'cancelled'; chain: number; detail: string | null; at: number }
export interface ChannelDetail {
  channel: { id: string; name: string; instructions: string; lead: string; createdAt: number };
  members: ChannelMember[]; messages: ChannelMessage[]; turns: ChannelTurn[]; cost: { usd: number; unpriced: number };
}
