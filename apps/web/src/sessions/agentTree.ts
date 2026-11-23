// The agents column (AgentsPane): the sessions of an instance put under their agent (Hermes profile), then under the
// agent's folders (Intendia workspaces), as OpenBot puts chats under each agent. Pure: tested in agentTree.test.ts.

import type { Agent, RecentSession, Workspace } from '../api';
import type { RunMark, RunState } from './running';

export type AgentFilter = 'all' | 'running' | 'unread';

export interface FolderNode { workspace: Workspace; sessions: RecentSession[] }

export interface AgentNode {
  name: string;
  /** listed by Hermes (false: only seen on sessions, the agent may have been deleted since) */
  known: boolean;
  isDefault: boolean;
  model: string | null;
  description: string;
  hasKey: boolean;
  /** the most pressing state of its sessions: waiting for the user first, then working */
  state: RunState | null;
  unread: number;
  /** its folders: the workspaces of this agent, and those where one of its sessions lives */
  folders: FolderNode[];
  /** its sessions out of any folder (Telegram, CLI, crons, kanban, API…) */
  others: RecentSession[];
}

export interface AgentTree {
  /** sessions waiting for the user (approval or question) */
  needsYou: RecentSession[];
  /** sessions whose agent works (a run, or background sub-agents) */
  working: RecentSession[];
  pinned: RecentSession[];
  agents: AgentNode[];
}

const RANK: Record<RunState, number> = { waiting: 3, running: 2, subagents: 1 };

function worse(a: RunState | null, b: RunState | undefined): RunState | null {
  if (!b) return a;
  return !a || RANK[b] > RANK[a] ? b : a;
}

/**
 * Builds the column. `workspaces`: those of the instance; a workspace without a profile belongs to `default`.
 * `filter` keeps only working or unread sessions (folders and agents left empty are then dropped).
 */
export function agentTree({ sessions, agents, workspaces, marks, isUnread, filter = 'all' }: {
  sessions: readonly RecentSession[];
  agents: readonly Agent[] | undefined;
  workspaces: readonly Workspace[];
  marks: ReadonlyMap<string, RunMark>;
  isUnread: (s: RecentSession) => boolean;
  filter?: AgentFilter;
}): AgentTree {
  const keep = (s: RecentSession) => filter === 'all' || (filter === 'running' ? marks.has(s.id) : isUnread(s));
  const shown = sessions.filter(keep);
  const nodes = new Map<string, AgentNode>();
  const node = (name: string): AgentNode => {
    let n = nodes.get(name);
    if (!n) {
      const a = agents?.find((x) => x.name === name);
      n = {
        name, known: Boolean(a), isDefault: a ? a.isDefault : name === 'default', model: a?.model ?? null, description: a?.description ?? '',
        hasKey: a?.hasKey ?? false, state: null, unread: 0, folders: [], others: [],
      };
      nodes.set(name, n);
    }
    return n;
  };
  // every agent Hermes lists, in its order (the default first), even without a session
  for (const a of [...(agents ?? [])].sort((x, y) => Number(y.isDefault) - Number(x.isDefault))) node(a.name);
  const folderOf = new Map<string, FolderNode>();
  const folder = (n: AgentNode, ws: Workspace): FolderNode => {
    const key = `${n.name}\n${ws.slug}`;
    let f = folderOf.get(key);
    if (!f) {
      f = { workspace: ws, sessions: [] };
      folderOf.set(key, f);
      n.folders.push(f);
    }
    return f;
  };
  // a workspace's own agent shows it even when empty (a new session starts there)
  if (filter === 'all') {
    for (const ws of workspaces) {
      const owner = ws.profile ?? 'default';
      if (agents && !agents.some((a) => a.name === owner)) continue;
      folder(node(owner), ws);
    }
  }
  for (const s of shown) {
    const n = node(s.profile);
    n.state = worse(n.state, marks.get(s.id)?.state);
    if (isUnread(s)) n.unread += 1;
    const ws = s.kind === 'intendia' && s.workspace ? workspaces.find((w) => w.slug === s.workspace) : undefined;
    if (ws) folder(n, ws).sessions.push(s);
    else n.others.push(s);
  }
  for (const n of nodes.values()) {
    // folders with recent activity first, then by name
    const last = (f: FolderNode) => f.sessions[0]?.at ?? 0;
    n.folders.sort((a, b) => last(b) - last(a) || a.workspace.name.localeCompare(b.workspace.name));
  }
  const all = [...nodes.values()].filter((n) => filter === 'all' || n.folders.length > 0 || n.others.length > 0);
  return {
    needsYou: shown.filter((s) => marks.get(s.id)?.state === 'waiting'),
    working: shown.filter((s) => { const st = marks.get(s.id)?.state; return st === 'running' || st === 'subagents'; }),
    pinned: shown.filter((s) => s.pinned),
    agents: all,
  };
}

/** Avatar colours of the agents (white initial on them), picked from the name: same agent, same colour everywhere. */
export const AGENT_COLORS = ['#f26d0d', '#2f6fdb', '#1f8a5b', '#8b5cf6', '#d63a6f', '#0f8fa3', '#b7791f', '#5b6472'] as const;

export function agentColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length] ?? AGENT_COLORS[0];
}

/** One or two letters for the avatar: « default » → « D », « veille-prix » → « VP ». */
export function agentInitials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 1);
  return letters.toUpperCase();
}
