import { callOp } from '../connectors/runtime.js';
import type { CompatService } from '../compat/service.js';
import type { SessionContext } from '../workspaces/service.js';
import { readHistory } from './history.js';

/**
 * Sessions of the sub-agents of an Intendia session (Hermes 0.23: one session per child, `source: subagent`,
 * `parent_session_id` = the parent; listed by `GET /api/sessions` only with `include_children`). Only the session
 * row is read (last activity, tool count, end), never the child's messages.
 */
export interface SubagentChild {
  id: string;
  /** Hermes' preview (first 60 characters of the child's first message = its goal), without the final "..." */
  goal: string;
  /** the preview was cut by Hermes */
  cut: boolean;
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  lastActive: number | null;
  toolCalls: number | null;
  apiCalls: number | null;
}

const LIST_LIMIT = 100;
/** 500 rows at most per re-reading */
const MAX_PAGES = 5;
const TIMEOUT_MS = 10_000;

interface RawChild {
  id?: unknown; source?: unknown; parent_session_id?: unknown; is_internal_child?: unknown; preview?: unknown;
  started_at?: unknown; ended_at?: unknown; end_reason?: unknown; last_active?: unknown; tool_call_count?: unknown; api_call_count?: unknown;
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toChild(r: RawChild): SubagentChild {
  const preview = typeof r.preview === 'string' ? r.preview.trim() : '';
  const cut = preview.endsWith('...');
  return {
    id: String(r.id), goal: cut ? preview.slice(0, -3).trimEnd() : preview, cut,
    startedAt: n(r.started_at), endedAt: n(r.ended_at), endReason: typeof r.end_reason === 'string' ? r.end_reason : null,
    lastActive: n(r.last_active), toolCalls: n(r.tool_call_count), apiCalls: n(r.api_call_count),
  };
}

export async function listChildren(compat: CompatService, ctx: SessionContext): Promise<SubagentChild[]> {
  const inst = ctx.instance.id;
  const h = await readHistory(compat, inst, ctx.session.id, ctx.profile, 1);
  if (!h.exists) return [];
  const parents = new Set([ctx.session.id, h.liveId]);
  // the list covers the whole profile (newest activity first): a few pages before concluding a child is absent
  const rows: RawChild[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await callOp<{ data: RawChild[] }>(compat.http(inst), compat.get(inst), 'sessions', 'list', {
      profile: ctx.profile, query: { include_children: 'true', limit: LIST_LIMIT, offset: page * LIST_LIMIT }, timeoutMs: TIMEOUT_MS,
    });
    rows.push(...res.data);
    if (res.data.length < LIST_LIMIT) break;
  }
  return rows
    .filter((r) => typeof r.id === 'string' && typeof r.parent_session_id === 'string' && parents.has(r.parent_session_id)
      && (r.source === 'subagent' || r.is_internal_child === true))
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .map(toChild)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}
