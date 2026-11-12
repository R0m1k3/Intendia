// Run events → thread entries. No React here: unit-tested in events.test.ts.
import type { ChatMessage, DelegationInfo } from '../api';
import { deliverySummary, EMPTY_DELIVERY } from './deliveries';
import { parseRelaunch } from './goal';

export type ToolState = 'running' | 'ok' | 'failed';

export type Entry =
  /** steer: given to the agent during its run (reorientation); relaunch: sent by Intendia's goal loop (chat/goal.ts) */
  | { kind: 'user'; key: string; text: string; ts: number | null; steer?: boolean; relaunch?: { n: number; max: number } }
  | { kind: 'assistant'; key: string; text: string; ts: number | null; streaming?: boolean }
  | { kind: 'reasoning'; key: string; text: string; ts: number | null }
  | { kind: 'tool'; key: string; callId: string | null; tool: string; preview: string; result: string | null; duration: number | null; state: ToolState; ts: number | null }
  | { kind: 'note'; key: string; text: string; tone: 'muted' | 'bad'; ts: number | null }
  /** openSince: seconds, oldest start of its background nodes (absent when none) */
  | { kind: 'subagents'; key: string; nodes: SubagentNode[]; ts: number | null; openSince?: number }
  /** result of background sub-agents (Hermes' delivery row): its own turn, no action on it */
  | { kind: 'delegation'; key: string; text: string; info: DelegationInfo; summary: string; ts: number | null };

/** One delegated sub-agent of a run (Hermes subagent.start / subagent.complete). */
export interface SubagentNode {
  id: string;
  parentId: string | null;
  depth: number;
  goal: string;
  model: string | null;
  /**
   * running until subagent.complete, then Hermes' status (completed when absent); background: left running after
   * the run (delegate_task in the background), until its delivery; truncated: delivered incomplete
   */
  status: string;
  /** delegation id of the call (live event) or of its unit (ticket); null for a synchronous result */
  delegationId: string | null;
  /** base 0 */
  taskIndex: number | null;
  /** session of the sub-agent at Hermes (live event only) */
  childSessionId: string | null;
  /** live tracking of a background node: its child session (chat/deliveries.ts attachChildren) */
  activity?: { lastActive: number | null; toolCalls: number | null; ended: boolean };
  /** seconds (event timestamp), null when unknown */
  startedAt: number | null;
  duration: number | null;
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCount: number | null;
  summary: string | null;
}

export interface Approval {
  requestId: string | null;
  command: string | null;
  description: string | null;
  choices: string[];
}

/** A question of the agent (clarify tool) waiting for an answer. */
export interface Clarify {
  requestId: string | null;
  question: string;
  choices: string[];
  multiSelect: boolean;
}

export interface RunState {
  entries: Entry[];
  approval: Approval | null;
  clarify: Clarify | null;
  /** Reorientation Hermes could not give the agent before the end (read on the final event). */
  pendingSteer: string | null;
  /**
   * queued | running | waiting_for_approval | stopping | completed | failed | cancelled | interrupted | error, and
   * waiting_for_clarify (Intendia's own: Hermes keeps a run waiting for a question `running`)
   */
  status: string;
  error: string | null;
  /** Hermes no longer had the start of the run (replay.truncated): it shows up in the history at the end. */
  truncated: boolean;
}

export const TERMINAL = ['completed', 'failed', 'cancelled', 'interrupted', 'unknown', 'error'];
export const isTerminal = (status: string) => TERMINAL.includes(status);

export type RunEvent = { event: string; seq?: number; timestamp?: number } & Record<string, unknown>;

export function initialRun(entries: Entry[] = []): RunState {
  return { entries, approval: null, clarify: null, pendingSteer: null, status: 'queued', error: null, truncated: false };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

let keySeq = 0;
const key = (prefix: string, seq?: number) => `${prefix}-${seq ?? `l${++keySeq}`}`;

function closeStreaming(entries: Entry[]): Entry[] {
  const last = entries.at(-1);
  return last?.kind === 'assistant' && last.streaming ? [...entries.slice(0, -1), { ...last, streaming: false }] : entries;
}

function updateTool(entries: Entry[], ev: RunEvent, patch: (t: Extract<Entry, { kind: 'tool' }>) => Entry): Entry[] {
  const callId = typeof ev.call_id === 'string' ? ev.call_id : null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind !== 'tool') continue;
    if (callId ? e.callId === callId : e.state === 'running' && e.tool === ev.tool) {
      return [...entries.slice(0, i), patch(e), ...entries.slice(i + 1)];
    }
  }
  return entries;
}

/** Applies one Hermes run event (or Intendia's own intendia.error) to the run state. */
export function reduceEvent(state: RunState, ev: RunEvent): RunState {
  const ts = typeof ev.timestamp === 'number' ? ev.timestamp : null;
  const s = { ...state };
  switch (ev.event) {
    case 'run.queued':
      return { ...s, status: 'queued' };
    case 'run.started':
    case 'message.started':
    case 'run.steered':
      return { ...s, status: s.status === 'queued' ? 'running' : s.status };
    case 'run.stopping':
      return { ...s, status: 'stopping' };
    case 'message.delta': {
      const last = s.entries.at(-1);
      const delta = str(ev.delta);
      if (last?.kind === 'assistant' && last.streaming) {
        return { ...s, status: 'running', entries: [...s.entries.slice(0, -1), { ...last, text: last.text + delta }] };
      }
      return { ...s, status: 'running', entries: [...s.entries, { kind: 'assistant', key: key('a', ev.seq), text: delta, ts, streaming: true }] };
    }
    case 'message.interim':
      if (ev.already_streamed) return s;
      return { ...s, entries: [...closeStreaming(s.entries), { kind: 'assistant', key: key('i', ev.seq), text: str(ev.text), ts }] };
    case 'reasoning.available':
      return { ...s, entries: [...closeStreaming(s.entries), { kind: 'reasoning', key: key('r', ev.seq), text: str(ev.text), ts }] };
    case 'tool.started':
      return {
        ...s, status: 'running',
        entries: [...closeStreaming(s.entries), {
          kind: 'tool', key: key('t', ev.seq), callId: typeof ev.call_id === 'string' ? ev.call_id : null,
          tool: str(ev.tool) || 'outil', preview: str(ev.preview), result: null, duration: null, state: 'running', ts,
        }],
      };
    case 'tool.progress':
      return { ...s, entries: updateTool(s.entries, ev, (t) => ({ ...t, preview: str(ev.preview) || t.preview })) };
    case 'tool.completed':
    case 'tool.failed': {
      const failed = ev.event === 'tool.failed' || ev.error === true;
      return {
        ...s,
        entries: updateTool(s.entries, ev, (t) => ({
          ...t, state: failed ? 'failed' : 'ok', result: str(ev.preview) || null,
          duration: typeof ev.duration === 'number' ? ev.duration : null,
        })),
      };
    }
    case 'approval.request':
      return {
        ...s, status: 'waiting_for_approval',
        approval: {
          // gateway session authority (Hermes 0.23): prompt_id; API server without it: request_id
          requestId: typeof ev.prompt_id === 'string' ? ev.prompt_id : typeof ev.request_id === 'string' ? ev.request_id : null,
          command: typeof ev.command === 'string' ? ev.command : null,
          description: typeof ev.description === 'string' ? ev.description : null,
          choices: Array.isArray(ev.choices) ? ev.choices.map(String) : ['once', 'deny'],
        },
      };
    // Hermes says only that it took a reorientation: the page shows its text (intendia.steer, see useRun)
    case 'run.steered':
      return s;
    case 'intendia.steer':
      return {
        ...s, entries: [...closeStreaming(s.entries), { kind: 'user', key: key('steer', ev.seq), text: str(ev.text), ts, steer: true }],
      };
    case 'clarify.request':
      return {
        ...s, status: 'waiting_for_clarify',
        entries: closeStreaming(s.entries),
        clarify: {
          requestId: typeof ev.prompt_id === 'string' ? ev.prompt_id : null,
          question: str(ev.question) || 'Hermes vous pose une question',
          choices: Array.isArray(ev.choices) ? ev.choices.map(String) : [],
          multiSelect: ev.multi_select === true,
        },
      };
    case 'clarify.settled':
      return { ...s, status: s.status === 'waiting_for_clarify' ? 'running' : s.status, clarify: null };
    case 'approval.responded':
    case 'approval.settled':
      return {
        ...s, status: 'running', approval: null,
        entries: [...s.entries, { kind: 'note', key: key('n', ev.seq), text: ev.choice == null ? 'Approbation répondue' : `Approbation : ${CHOICE_LABEL[str(ev.choice)] ?? str(ev.choice)}`, tone: 'muted', ts }],
      };
    case 'subagent.start':
    case 'subagent.complete':
      return { ...s, entries: reduceSubagent(s.entries, ev, ts) };
    case 'run.completed': {
      const entries = closeStreaming(s.entries);
      const hasAnswer = entries.some((e) => e.kind === 'assistant' && e.text.trim());
      const output = str(ev.output);
      return {
        ...s, status: 'completed', approval: null, clarify: null, pendingSteer: pendingSteerOf(ev),
        entries: !hasAnswer && output ? [...entries, { kind: 'assistant', key: key('a', ev.seq), text: output, ts }] : entries,
      };
    }
    case 'run.failed':
    case 'run.cancelled':
    case 'run.interrupted': {
      const status = ev.event.slice(4);
      return { ...s, status, approval: null, clarify: null, pendingSteer: pendingSteerOf(ev), error: str(ev.error) || null, entries: closeStreaming(s.entries) };
    }
    case 'replay.truncated':
      return { ...s, truncated: true };
    case 'intendia.error':
      return { ...s, status: 'error', approval: null, clarify: null, error: str(ev.message) || 'Flux interrompu', entries: closeStreaming(s.entries) };
    default:
      return { ...s, entries: [...s.entries, { kind: 'note', key: key('n', ev.seq), text: ev.event, tone: 'muted', ts }] };
  }
}

const pendingSteerOf = (ev: RunEvent): string | null => (typeof ev.pending_steer === 'string' && ev.pending_steer.trim() ? ev.pending_steer : null);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One `subagents` entry per run, placed where the first sub-agent started; nodes are keyed by
 * subagent_id (without it: goal + rank). A complete without a matching start adds a finished node.
 */
function reduceSubagent(entries: Entry[], ev: RunEvent, ts: number | null): Entry[] {
  const at = entries.findIndex((e) => e.kind === 'subagents');
  // seq is local to a run: the run id keeps the trees of two runs of the same session apart (withTrees)
  const runId = typeof ev.run_id === 'string' && ev.run_id ? ev.run_id : null;
  const tree = at >= 0 ? (entries[at] as Extract<Entry, { kind: 'subagents' }>)
    : { kind: 'subagents' as const, key: runId ? `sa-${runId}-${ev.seq ?? 0}` : key('sa', ev.seq), nodes: [], ts };
  const nodes = [...tree.nodes];
  const goal = str(ev.goal);
  let id = typeof ev.subagent_id === 'string' && ev.subagent_id ? ev.subagent_id : null;
  if (!id) {
    const same = nodes.filter((n) => n.id.startsWith(`${goal}#`));
    // a complete without id closes the oldest running node with that goal
    const open = ev.event === 'subagent.complete' ? same.find((n) => n.status === 'running') : undefined;
    id = open?.id ?? `${goal}#${same.length + 1}`;
  }
  const i = nodes.findIndex((n) => n.id === id);
  const prev: SubagentNode = i >= 0 ? nodes[i]! : {
    id, parentId: null, depth: 0, goal, model: null, status: 'running', startedAt: ts,
    duration: null, cost: null, inputTokens: null, outputTokens: null, toolCount: null, summary: null,
    delegationId: null, taskIndex: null, childSessionId: null,
  };
  const parent = typeof ev.parent_id === 'string' && ev.parent_id ? ev.parent_id : null;
  const next: SubagentNode = {
    ...prev,
    parentId: parent ?? prev.parentId,
    depth: num(ev.depth) ?? prev.depth,
    goal: goal || prev.goal,
    model: (typeof ev.model === 'string' && ev.model) || prev.model,
    delegationId: (typeof ev.delegation_id === 'string' && ev.delegation_id) || prev.delegationId,
    taskIndex: num(ev.task_index) ?? prev.taskIndex,
    childSessionId: (typeof ev.child_session_id === 'string' && ev.child_session_id) || prev.childSessionId,
  };
  if (ev.event === 'subagent.complete') {
    next.status = str(ev.status) || 'completed';
    next.duration = num(ev.duration_seconds) ?? prev.duration;
    next.cost = num(ev.cost_usd) ?? prev.cost;
    next.inputTokens = num(ev.input_tokens) ?? prev.inputTokens;
    next.outputTokens = num(ev.output_tokens) ?? prev.outputTokens;
    next.toolCount = num(ev.tool_count) ?? prev.toolCount;
    next.summary = str(ev.summary) || prev.summary;
  }
  if (i >= 0) nodes[i] = next;
  else nodes.push(next);
  const updated = { ...tree, nodes };
  return at >= 0 ? [...entries.slice(0, at), updated, ...entries.slice(at + 1)] : [...closeStreaming(entries), updated];
}

/** Nodes in display order (depth-first by parent), each with its depth in the tree; unknown parents hang off the root. */
export function subagentTree(nodes: SubagentNode[]): { node: SubagentNode; level: number }[] {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, SubagentNode[]>();
  for (const n of nodes) {
    const p = n.parentId && ids.has(n.parentId) && n.parentId !== n.id ? n.parentId : null;
    children.set(p, [...(children.get(p) ?? []), n]);
  }
  const out: { node: SubagentNode; level: number }[] = [];
  const seen = new Set<string>();
  const walk = (p: string | null, level: number) => {
    for (const n of children.get(p) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, level });
      walk(n.id, level + 1);
    }
  };
  walk(null, 0);
  // cycles (a → b → a) never reach the root: show them flat at the end
  for (const n of nodes) if (!seen.has(n.id)) out.push({ node: n, level: 0 });
  return out;
}

/**
 * Hermes' history has no sub-agent events: the trees of runs followed on this page are put back
 * into it, each before the first entry that came after its first sub-agent (else at the end).
 */
export function withTrees(entries: Entry[], trees: Extract<Entry, { kind: 'subagents' }>[]): Entry[] {
  let out = [...entries];
  const place = (ts: number | null) => {
    const at = ts === null ? -1 : out.findIndex((e) => e.kind !== 'subagents' && e.ts !== null && e.ts > ts);
    return at < 0 ? out.length : at;
  };
  for (const t of trees) {
    if (out.some((e) => e.key === t.key)) continue;
    // the live tree is richer (cost, nested sub-agents): the cards read from the history for that turn go
    const at = place(t.ts);
    const question = (e: Entry) => e.kind === 'user' && !e.steer;
    let from = at - 1;
    while (from >= 0 && !question(out[from]!)) from--;
    let to = at;
    while (to < out.length && !question(out[to]!)) to++;
    out = out.filter((e, i) => !(i > from && i < to && e.kind === 'subagents' && e.key.startsWith('h')));
    out.splice(place(t.ts), 0, t);
  }
  return out;
}

export const CHOICE_LABEL: Record<string, string> = {
  once: 'autorisé une fois',
  session: 'autorisé pour la session',
  always: 'toujours autorisé',
  deny: 'refusé',
};

/** Session history (oldest first) → entries; tool results attach to their call. */
export function historyEntries(messages: ChatMessage[]): Entry[] {
  const out: Entry[] = [];
  // tool lines of the last assistant message with tool calls: Hermes writes their results in call order
  let calls: Extract<Entry, { kind: 'tool' }>[] = [];
  for (const m of messages) {
    const k = `h${m.id}`;
    if (m.role === 'delegation') {
      const info = m.delegation ?? EMPTY_DELIVERY;
      out.push({ kind: 'delegation', key: k, text: m.content, info, summary: deliverySummary(info), ts: m.timestamp });
    } else if (m.role === 'user') {
      const relaunch = parseRelaunch(m.content);
      out.push({ kind: 'user', key: k, text: m.content, ts: m.timestamp, ...(m.steer ? { steer: true } : {}), ...(relaunch ? { relaunch } : {}) });
    }
    else if (m.role === 'assistant') {
      if (m.content.trim()) out.push({ kind: 'assistant', key: k, text: m.content, ts: m.timestamp });
      if (m.toolCalls.length) calls = [];
      m.toolCalls.forEach((t, i) => {
        const line: Extract<Entry, { kind: 'tool' }> = {
          kind: 'tool', key: `${k}-${i}`, callId: null, tool: t.name, preview: t.arguments === '{}' ? '' : t.arguments,
          result: null, duration: null, state: 'ok', ts: m.timestamp,
        };
        calls.push(line);
        out.push(line);
      });
    } else if (m.role === 'tool') {
      const fits = (e: Entry): e is Extract<Entry, { kind: 'tool' }> => e.kind === 'tool' && e.result === null && (!m.toolName || e.tool === m.toolName);
      // first open call of that tool in the last message, else (older shapes) the last open one anywhere
      const open = calls.find((e) => fits(e) && out.includes(e)) ?? [...out].reverse().find(fits);
      if (!open) {
        out.push({ kind: 'tool', key: k, callId: null, tool: m.toolName ?? 'outil', preview: '', result: m.content, duration: null, state: 'ok', ts: m.timestamp });
        continue;
      }
      open.result = m.content;
      const nodes = open.tool === 'delegate_task'
        ? delegationNodes(open.preview, m.content, open.key, open.ts) ?? dispatchedNodes(open.preview, m.content, open.key, m.timestamp ?? open.ts)
        : null;
      if (nodes) out[out.indexOf(open)] = { kind: 'subagents', key: open.key, nodes, ts: open.ts };
    }
  }
  return out;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };

/**
 * Sub-agent cards from a delegate_task call and its stored result (`{results: [{task_index, status, summary,
 * error, duration_seconds, model, tokens}]}`); null when the result is not that (cut, background delegation).
 */
export function delegationNodes(argsJson: string, resultJson: string, key: string, ts: number | null): SubagentNode[] | null {
  const results = obj(parse(resultJson))?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const args = obj(parse(argsJson || '{}')) ?? {};
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  return results.map((raw, i): SubagentNode => {
    const r = obj(raw) ?? {};
    const index = num(r.task_index) ?? i;
    const goal = str(obj(tasks[index])?.goal) || str(args.goal);
    const tokens = obj(r.tokens);
    return {
      id: `${key}-${index}`, parentId: null, depth: 1, goal,
      model: typeof r.model === 'string' && r.model ? r.model : null,
      status: str(r.status) || 'completed', startedAt: ts, duration: num(r.duration_seconds), cost: null,
      inputTokens: num(tokens?.input), outputTokens: num(tokens?.output), toolCount: null,
      summary: str(r.summary) || str(r.error) || null, delegationId: null, taskIndex: index, childSessionId: null,
    };
  });
}

export interface Ticket {
  delegationId: string | null;
  goals: string[];
  refused: Set<number>;
  /** unit ids (independent completions), each with its task indexes */
  units: { id: string; tasks: number[] }[];
}

/** Result of a delegate_task in the background (`{status: dispatched, mode: background, …}`), else null. */
export function readTicket(content: string): Ticket | null {
  const t = obj(parse(content));
  if (!t || t.status !== 'dispatched' || t.mode !== 'background') return null;
  const refused = new Set<number>();
  if (Array.isArray(t.refused)) for (const r of t.refused) { const i = num(obj(r)?.task_index); if (i !== null) refused.add(i); }
  const units = Array.isArray(t.units)
    ? t.units.map((u) => obj(u)).filter((u): u is Record<string, unknown> => !!u && typeof u.delegation_id === 'string' && !!u.delegation_id)
      .map((u) => ({ id: u.delegation_id as string, tasks: Array.isArray(u.task_indexes) ? u.task_indexes.map(num).filter((n): n is number => n !== null) : [] }))
    : [];
  return {
    delegationId: typeof t.delegation_id === 'string' && t.delegation_id ? t.delegation_id : null,
    goals: Array.isArray(t.goals) ? t.goals.map((g) => str(g)) : [], refused, units,
  };
}

/** Cards of a delegate_task in the background: one `background` node per task not refused by Hermes. */
export function dispatchedNodes(argsJson: string, resultJson: string, key: string, ts: number | null): SubagentNode[] | null {
  const t = readTicket(resultJson);
  if (!t) return null;
  const args = obj(parse(argsJson || '{}')) ?? {};
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  const goals = t.goals.length ? t.goals : tasks.length ? tasks.map((x) => str(obj(x)?.goal)) : [str(args.goal)];
  const nodes: SubagentNode[] = [];
  goals.forEach((goal, index) => {
    if (t.refused.has(index)) return;
    nodes.push({
      id: `${key}-${index}`, parentId: null, depth: 1, goal: goal || str(obj(tasks[index])?.goal), model: null, status: 'background',
      startedAt: ts, duration: null, cost: null, inputTokens: null, outputTokens: null, toolCount: null, summary: null,
      delegationId: t.units.find((u) => u.tasks.includes(index))?.id ?? t.delegationId, taskIndex: index, childSessionId: null,
    });
  });
  return nodes.length ? nodes : null;
}

/**
 * Thread during a run: history before the run started, the run's own user message (unless the live
 * entries already have it, after a send from this page), then the live entries. Hermes may already have
 * written messages of the running run; those come from the events only, so nothing shows twice.
 */
export function mergeHistory(history: ChatMessage[], runCreatedAt: number | null, live: Entry[]): Entry[] {
  if (runCreatedAt === null) return [...historyEntries(history), ...live];
  const before = history.filter((m) => (m.timestamp ?? 0) < runCreatedAt);
  // the run's own prompt, never a reorientation (live or written by Hermes during the run)
  const runUser = live.some((e) => e.kind === 'user' && !e.steer) ? undefined
    : history.find((m) => m.role === 'user' && !m.steer && (m.timestamp ?? 0) >= runCreatedAt);
  return [...historyEntries(runUser ? [...before, runUser] : before), ...live];
}
