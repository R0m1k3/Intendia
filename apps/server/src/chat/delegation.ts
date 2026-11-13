// Delivery row of a background sub-agent (`display_kind: async_delegation_complete`, Hermes 0.23). The API server
// does not serve `display_metadata` (`_message_response`): everything is read from Hermes' text (format of
// `tools/process_registry_notifications.py`), then a valid metadata field, if a later version serves it, wins.
// This is the only place that reads that English text.

/** Hermes' raw status kept (as the synchronous path), except: success → completed, error / rejected / ? → failed / unknown, truncated → truncated. */
export type TaskStatus = string;

export interface DelegationInfo {
  /** From the text header (or display_metadata.delegation_id); null only without either. */
  id: string | null;
  tasks: number | null;
  completed: number | null;
  failed: number | null;
  durationSeconds: number | null;
  /** Base 0: early failure notice of one task (the others go on). */
  failedTask: number | null;
  /** Base 0; index null = the single task of a single-child delivery. Empty when the text gives none. */
  taskStatuses: { index: number | null; status: TaskStatus }[];
  /** A batch without any result (`--- ERROR ---` block). */
  allFailed: boolean;
}

const HEADER_RE = /^\[ASYNC DELEGATION (BATCH )?COMPLETE — ([^\]\s]+)\]/m;
const NOTICE_RE = /^\[ASYNC DELEGATION TASK FAILED — ([^,\]\s]+), task (\d+)\/(\d+)\]/m;
const SECTION_RE = /^--- (✓|✗|⚠) TASK (\d+)\/(\d+)(.*)$/gm;
const SINGLE_STATUS_RE = /^Status: (\S+)(.*)$/m;

/** Hermes' status word → Intendia's (see TaskStatus). */
export function taskStatus(raw: string): TaskStatus {
  const s = raw.trim().toLowerCase();
  if (s === 'success') return 'completed';
  if (s === 'error' || s === 'rejected') return 'failed';
  if (s === '?' || !s) return 'unknown';
  return s;
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const seconds = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function fromText(text: string): DelegationInfo {
  const info: DelegationInfo = { id: null, tasks: null, completed: null, failed: null, durationSeconds: null, failedTask: null, taskStatuses: [], allFailed: false };
  const notice = NOTICE_RE.exec(text);
  if (notice) {
    info.id = notice[1]!;
    info.failedTask = Number(notice[2]) - 1;
    return info;
  }
  const header = HEADER_RE.exec(text);
  if (!header) return info;
  info.id = header[2]!;
  if (header[1]) {
    for (const m of text.matchAll(SECTION_RE)) {
      const status = /\(status=([^,)\s]+)[^)]*\)\s*---\s*$/.exec(m[4]!)?.[1];
      const st = m[1] === '⚠' ? 'truncated' : status !== undefined ? taskStatus(status) : m[1] === '✓' ? 'completed' : 'failed';
      info.taskStatuses.push({ index: Number(m[2]) - 1, status: st });
    }
    if (info.taskStatuses.length) {
      info.tasks = info.taskStatuses.length;
      info.failed = info.taskStatuses.filter((t) => t.status === 'failed').length;
      info.completed = info.tasks - info.failed;
    } else if (/^--- ERROR ---$/m.test(text)) {
      info.allFailed = true;
    }
    info.durationSeconds = num(/Total duration: ([\d.]+)s/.exec(text)?.[1]);
    return info;
  }
  const status = SINGLE_STATUS_RE.exec(text.split(/^--- RESULT ---$/m)[0]!);
  if (status) {
    const st = /TRUNCATED/.test(status[2]!) ? 'truncated' : taskStatus(status[1]!);
    info.taskStatuses.push({ index: null, status: st });
    info.tasks = 1;
    info.failed = st === 'failed' ? 1 : 0;
    info.completed = 1 - info.failed;
    info.durationSeconds = num(/Duration: ([\d.]+)s/.exec(status[2]!)?.[1]);
  }
  return info;
}

export function delegationInfo(metadata: unknown, text: string): DelegationInfo {
  const info = fromText(text);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return info;
  const md = metadata as Record<string, unknown>;
  if (typeof md.delegation_id === 'string' && md.delegation_id.trim()) info.id = md.delegation_id.trim();
  const notice = typeof md.delivery_notice === 'string' ? /^task_failure:(\d+)$/.exec(md.delivery_notice) : null;
  if (notice) {
    info.failedTask = Number(notice[1]);
    return info;
  }
  if (info.failedTask !== null) return info;
  info.tasks = count(md.task_count) ?? info.tasks;
  info.completed = count(md.completed_count) ?? info.completed;
  info.failed = count(md.failed_count) ?? info.failed;
  info.durationSeconds = seconds(md.duration_seconds) ?? info.durationSeconds;
  return info;
}

// ---- Tickets: result of a delegate_task in the background (`{status: dispatched, mode: background, …}`)

/** JSON form, sent to the page with the tool message (`ChatMessage.ticket`). */
export interface TicketInfo {
  delegationId: string | null;
  goals: string[];
  /** base 0: tasks Hermes refused (no child, no delivery) */
  refused: number[];
  /** unit ids (`delegation.independent_completions`), each with its task indexes; empty = one unit, the call */
  units: { id: string; tasks: number[] }[];
}

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const index = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

export function readTicket(content: string): TicketInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const t = asObj(parsed);
  if (!t || t.status !== 'dispatched' || t.mode !== 'background') return null;
  const refused: number[] = [];
  if (Array.isArray(t.refused)) for (const r of t.refused) { const i = index(asObj(r)?.task_index); if (i !== null && !refused.includes(i)) refused.push(i); }
  const units = Array.isArray(t.units)
    ? t.units.map(asObj).filter((u): u is Record<string, unknown> => !!u && typeof u.delegation_id === 'string' && !!u.delegation_id)
      .map((u) => ({ id: u.delegation_id as string, tasks: Array.isArray(u.task_indexes) ? u.task_indexes.map(index).filter((n): n is number => n !== null) : [] }))
    : [];
  return {
    delegationId: typeof t.delegation_id === 'string' && t.delegation_id ? t.delegation_id : null,
    goals: Array.isArray(t.goals) ? t.goals.map((g) => (typeof g === 'string' ? g : '')) : [], refused, units,
  };
}

/** What the server needs of a message to follow delegations (a subset of ChatMessage). */
export interface DelegationMessage {
  role: string;
  timestamp: number | null;
  ticket?: TicketInfo;
  delegation?: DelegationInfo;
}

export interface OpenDelegations {
  /** unit id → timestamp (seconds) of its ticket */
  open: Map<string, number | null>;
  /** tasks not refused of the open units */
  openTasks: number;
  /** seconds: newest ticket still open */
  since: number | null;
}

/**
 * Units still waiting for their full delivery (an early failure notice does not close a unit). Same rules as the
 * page's `delegationState` (web/src/chat/deliveries.ts), which keeps what the cards need.
 */
export function delegationState(messages: readonly DelegationMessage[]): OpenDelegations {
  const open = new Map<string, number | null>();
  const tasks = new Map<string, number>();
  const delivered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.ticket) {
      const t = m.ticket;
      if (t.units.length) {
        for (const u of t.units) {
          if (delivered.has(u.id)) continue;
          open.set(u.id, m.timestamp);
          tasks.set(u.id, u.tasks.filter((i) => !t.refused.includes(i)).length);
        }
      } else if (t.delegationId && !delivered.has(t.delegationId)) {
        open.set(t.delegationId, m.timestamp);
        const all = t.goals.length || 1;
        tasks.set(t.delegationId, Math.max(0, all - t.refused.filter((i) => i < all).length));
      }
    } else if (m.role === 'delegation' && m.delegation?.id && m.delegation.failedTask === null) {
      delivered.add(m.delegation.id);
      open.delete(m.delegation.id);
      tasks.delete(m.delegation.id);
    }
  }
  const times = [...open.values()].filter((v): v is number => v !== null);
  return { open, openTasks: [...tasks.values()].reduce((a, b) => a + b, 0), since: times.length ? Math.max(...times) : null };
}
