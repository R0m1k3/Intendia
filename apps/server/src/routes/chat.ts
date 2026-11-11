import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { RunStatusSchema, TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { callOp, HermesError, streamOp } from '../connectors/runtime.js';
import type { CompatReport } from '../connectors/types.js';
import { pushTitle } from '../workspaces/title.js';
import { COST_SETTLE_MS, finishFields, runCost, sessionCost, type CostReading } from '../chat/run-stats.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { autoModel, chatGroups, chatModelsManaged, type ChatModelList } from '../chat/models-list.js';
import type { ModelOptionsSchema } from '../connectors/chat/index.js';
import { NotFoundError, ValidationError, type RunStatRow, type SessionContext, type WorkspaceService } from '../workspaces/service.js';
import { SESSION_ID_RE, sessionParams } from './workspaces.js';

const RUN_ID_RE = /^run_[A-Za-z0-9]{1,64}$/;
const OTHER_PAGE = 50;

const SendBody = z.object({ input: z.string().min(1).max(100_000) });
const ClarifyBody = z.object({ answer: z.string().min(1).max(16_384), requestId: z.string().max(256).optional() });
const ApprovalBody = z.object({ choice: z.enum(['once', 'session', 'always', 'deny']), requestId: z.string().max(256).optional() });

interface RawMessage {
  id: number;
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_name?: string | null;
  timestamp?: number | null;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: { name: string; arguments: string }[];
  timestamp: number | null;
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('');
  }
  return content == null ? '' : JSON.stringify(content);
}

function toolCalls(raw: unknown): ChatMessage['toolCalls'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const fn = (t as { function?: { name?: unknown; arguments?: unknown } }).function ?? (t as { name?: unknown; arguments?: unknown });
    return { name: String(fn.name ?? '?'), arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) };
  });
}

/** Hermes messages → oldest first, without session_meta. */
export function toChatMessages(data: RawMessage[]): ChatMessage[] {
  return data
    .filter((m) => m.role !== 'session_meta')
    .sort((a, b) => a.id - b.id)
    .map((m) => ({
      id: m.id, role: m.role, content: text(m.content), toolName: m.tool_name ?? null,
      toolCalls: toolCalls(m.tool_calls), timestamp: m.timestamp ?? null,
    }));
}

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseError(status: number, message: string): Response {
  return new Response(`: open\n\n${sseFrame({ event: 'intendia.error', status, message })}`, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

const CONTROL_ERRORS = {
  no_pending: 'Plus rien n’attend votre réponse',
  ambiguous: 'Plusieurs demandes en attente : rechargez la page',
} as const;

/**
 * Body of an answer to an approval (or a question) of a run. With the gateway session authority (Hermes 0.23: the
 * status has an integer `execution_generation`), Hermes wants exactly `{request_id, execution_generation, choice}`
 * (`answer` for a question), the id being one of `pending_controls`: the page's id when it is listed, else the only
 * one of that kind. Without it (API server without authority), `{choice, request_id?}` as before.
 */
export function controlBody(
  kind: 'approval' | 'clarify', raw: unknown, requestId: string | null, value: string,
): { body: Record<string, unknown> } | { code: keyof typeof CONTROL_ERRORS } {
  const field = kind === 'approval' ? 'choice' : 'answer';
  const parsed = RunStatusSchema.safeParse(raw);
  const generation = parsed.success ? parsed.data.execution_generation : null;
  if (typeof generation !== 'number') return { body: { [field]: value, ...(requestId ? { request_id: requestId } : {}) } };
  const pending = (parsed.success ? parsed.data.pending_controls : []).filter((p) => p.kind === kind && p.prompt_id);
  const chosen = pending.find((p) => p.prompt_id === requestId) ?? (pending.length === 1 ? pending[0] : undefined);
  if (!chosen) return { code: pending.length ? 'ambiguous' : 'no_pending' };
  return { body: { request_id: chosen.prompt_id, execution_generation: chosen.execution_generation ?? generation, [field]: value } };
}

export function chatRoutes(deps: AppDeps & { workspaces: WorkspaceService }): Hono {
  const { workspaces, compat } = deps;
  const r = new Hono();

  const ctxOf = (c: Parameters<typeof sessionParams>[0]): SessionContext => {
    const { inst, id } = sessionParams(c);
    return workspaces.getSession(inst, id);
  };
  const report = (ctx: SessionContext): CompatReport | undefined => compat.get(ctx.instance.id);
  const http = (ctx: SessionContext) => compat.http(ctx.instance.id);

  /** The run must be the session's last run: a session only sees its own runs. */
  const runOf = (ctx: SessionContext, runId: string): string => {
    if (!RUN_ID_RE.test(runId)) throw new ValidationError('identifiant de run invalide');
    if (ctx.session.lastRunId !== runId) throw new NotFoundError('Run inconnu pour cette session');
    return runId;
  };

  interface RawStatus {
    status: string; session_id?: string | null; created_at?: number; updated_at?: number | null; output?: string | null; error?: string | null;
    usage?: unknown; runtime?: unknown;
  }
  /** Run status; a run Hermes forgot (404) is "unknown", treated as finished. `raw` feeds run_stats. */
  const status = async (ctx: SessionContext, runId: string) => {
    try {
      const s = await callOp<RawStatus>(http(ctx), report(ctx), 'chat', 'runStatus', { params: { run_id: runId }, profile: ctx.profile });
      return { status: s.status, createdAt: s.created_at ?? null, output: s.output ?? null, error: s.error ?? null, raw: s as RawStatus | null };
    } catch (err) {
      if (err instanceof HermesError && err.detail.status === 404) return { status: 'unknown', createdAt: null, output: null, error: null, raw: null };
      throw err;
    }
  };
  const publicStatus = ({ raw: _raw, ...s }: Awaited<ReturnType<typeof status>>) => s;

  /** Messages and the live session id (after a compression, the continuation); 404 = no message yet. */
  const history = async (instanceId: string, sessionId: string, profile: string, limit?: number) => {
    try {
      const res = await callOp<{ data: RawMessage[]; session_id?: string | null }>(compat.http(instanceId), compat.get(instanceId), 'sessions', 'messages', {
        params: { session_id: sessionId }, profile, ...(limit ? { query: { limit, order: 'latest' } } : {}),
      });
      return { messages: toChatMessages(res.data), liveId: res.session_id || sessionId, exists: true };
    } catch (err) {
      // an Intendia session before its first message does not exist at Hermes yet
      if (err instanceof HermesError && err.detail.status === 404) return { messages: [] as ChatMessage[], liveId: sessionId, exists: false };
      throw err;
    }
  };
  const messages = async (instanceId: string, sessionId: string, profile: string): Promise<ChatMessage[]> =>
    (await history(instanceId, sessionId, profile)).messages;

  /** Cumulated cost of the live session; null when it cannot be read (the run's cost is then unknown). */
  const liveCost = async (ctx: SessionContext, known?: { liveId: string; exists: boolean }): Promise<CostReading | null> => {
    try {
      const h = known ?? await history(ctx.instance.id, ctx.session.id, ctx.profile, 1);
      if (!h.exists) return { sessionId: h.liveId, cost: 0 };
      const s = await callOp<{ actual_cost_usd?: number | null; estimated_cost_usd?: number | null }>(
        http(ctx), report(ctx), 'sessions', 'get', { params: { session_id: h.liveId }, profile: ctx.profile },
      );
      return { sessionId: h.liveId, cost: sessionCost(s) };
    } catch {
      return null;
    }
  };

  /**
   * Records the end of the session's running rows (read once, written once), then re-costs its last finished
   * row while it is not final. Returns the status of the session's last run when it was read.
   */
  const settle = async (
    ctx: SessionContext, opts: { known?: { liveId: string; exists: boolean }; cost?: CostReading | null } = {},
  ) => {
    let last: Awaited<ReturnType<typeof status>> | null = null;
    const inst = ctx.instance.id;
    for (const row of workspaces.runStats(inst, ctx.session.id, { running: true }).filter((r) => r.status === 'running')) {
      const s = await status(ctx, row.runId);
      if (row.runId === ctx.session.lastRunId) last = s;
      const now = Date.now();
      if (s.raw === null) {
        workspaces.finishRunStat(inst, row.runId, { status: 'unknown', endedAt: now, hermesSessionId: null });
      } else if (TERMINAL_STATUSES.includes(s.status)) {
        const first = workspaces.finishRunStat(inst, row.runId, { ...finishFields(s.raw, now), hermesSessionId: s.raw.session_id ?? ctx.session.id });
        // the session exists at Hermes after its first run: give it the same title (Telegram, CLI), once, unawaited
        if (first && workspaces.runStats(inst, ctx.session.id, { running: true }).length === 1) {
          const fresh = workspaces.getSession(inst, ctx.session.id);
          void pushTitle(deps, fresh, fresh.session.title, 5_000);
        }
      }
    }
    const done = workspaces.runStats(inst, ctx.session.id);
    const tail: RunStatRow | undefined = done[done.length - 1];
    if (tail && !tail.costFinal && tail.status !== 'unknown') {
      const reading = opts.cost !== undefined ? opts.cost : await liveCost(ctx, opts.known);
      const final = tail.endedAt !== null && Date.now() - tail.endedAt > COST_SETTLE_MS;
      workspaces.setRunCost(inst, tail.runId, runCost(tail.costBeforeUsd, tail.costBeforeSessionId, reading), final);
    }
    return last;
  };

  /**
   * At send time, closes the cost of the session's last finished row and gives the new row its baseline. A row
   * Hermes has visibly not costed yet (ended less than COST_SETTLE_MS ago, tokens measured, nothing counted) is
   * not frozen at 0: its cost becomes unknown and the new row starts from its baseline, so the new row's cost
   * covers both. A row already costed is frozen (at worst its last call, still queued, lands on the next run).
   */
  const handOverCost = (ctx: SessionContext, cost: CostReading | null) => {
    const done = workspaces.runStats(ctx.instance.id, ctx.session.id);
    const tail: RunStatRow | undefined = done[done.length - 1];
    const fresh = { costBeforeUsd: cost?.cost ?? null, costBeforeSessionId: cost?.sessionId ?? null, costRuns: 1 };
    if (!tail || tail.costFinal) return fresh;
    if (tail.status === 'unknown') {
      workspaces.setRunCost(ctx.instance.id, tail.runId, null, true);
      return fresh;
    }
    const own = runCost(tail.costBeforeUsd, tail.costBeforeSessionId, cost);
    const pending = own === 0 && tail.inputTokens !== null && tail.endedAt !== null && Date.now() - tail.endedAt <= COST_SETTLE_MS;
    if (pending) {
      workspaces.setRunCost(ctx.instance.id, tail.runId, null, true);
      return { costBeforeUsd: tail.costBeforeUsd, costBeforeSessionId: tail.costBeforeSessionId, costRuns: tail.costRuns + 1 };
    }
    workspaces.setRunCost(ctx.instance.id, tail.runId, own, true);
    return fresh;
  };

  const publicRun = (r: RunStatRow) => ({
    runId: r.runId, status: r.status, requestedModel: r.requestedModel, requestedEffort: r.requestedEffort,
    servedModel: r.servedModel, startedAt: r.startedAt, endedAt: r.endedAt,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens,
    costUsd: r.costUsd, costRuns: r.costRuns, costFinal: r.costFinal,
  });

  const instanceProfile = (instanceId: string, profile: string | undefined): string => {
    const inst = deps.store.get(instanceId);
    if (!inst) throw new NotFoundError(`Instance inconnue : ${instanceId}`);
    const p = profile || 'default';
    if (p !== 'default' && !inst.profileKeys[p]) throw new ValidationError(`Profil inconnu : ${p}`);
    return p;
  };

  // ---- Intendia sessions (profile read from the workspace)

  r.get('/sessions/:inst/:id/messages', async (c) => {
    const ctx = ctxOf(c);
    const h = await history(ctx.instance.id, ctx.session.id, ctx.profile);
    // the consumption rows are settled here: the page re-reads the messages when a run ends
    await settle(ctx, { known: h });
    return c.json({ messages: h.messages, runs: workspaces.runStats(ctx.instance.id, ctx.session.id).map(publicRun) });
  });

  // one run creation at a time per session: two tabs could otherwise both pass the "no run in progress"
  // check and start two runs, the second overwriting the first in lastRunId
  const starting = new Set<string>();
  r.post('/sessions/:inst/:id/runs', async (c) => {
    const ctx = ctxOf(c);
    const { input } = SendBody.parse(await c.req.json());
    const key = `${ctx.instance.id}:${ctx.session.id}`;
    if (starting.has(key)) return c.json({ error: 'Un run est déjà en cours dans cette session' }, 409);
    starting.add(key);
    try {
      // re-read after the body: the session may have changed while it was received
      const fresh = workspaces.getSession(ctx.instance.id, ctx.session.id);
      const lastRunId = fresh.session.lastRunId;
      // one cost reading: cost of the previous run and "cost before" of this one
      const cost = await liveCost(fresh);
      let last = await settle(fresh, { cost });
      // a last run without a row (started before run_stats existed) is checked directly
      if (lastRunId && !last && !workspaces.runStats(fresh.instance.id, fresh.session.id).some((r) => r.runId === lastRunId)) {
        last = await status(fresh, lastRunId);
      }
      if (last && last.status !== 'unknown' && !TERMINAL_STATUSES.includes(last.status)) {
        return c.json({ error: 'Un run est déjà en cours dans cette session' }, 409);
      }
      const { model, modelProvider, effort } = fresh.session;
      const instructions = await workspaces.instructionsFor(fresh);
      const created = await callOp<{ run_id: string }>(http(ctx), report(ctx), 'chat', 'createRun', {
        profile: ctx.profile,
        body: {
          input, session_id: ctx.session.id, instructions,
          // provider only with a model picked in a group (docs/hermes-api-notes.md)
          ...(model ? { model, ...(modelProvider ? { provider: modelProvider } : {}) } : {}),
          ...(effort ? { model_options: { reasoning_effort: effort } } : {}),
        },
      });
      // after the run was accepted: a refused send leaves the previous row settling
      workspaces.insertRunStat({
        instanceId: ctx.instance.id, runId: created.run_id, sessionId: ctx.session.id, status: 'running',
        requestedModel: model, requestedEffort: effort, startedAt: Date.now(), ...handOverCost(fresh, cost),
      });
      const session = workspaces.recordRun(ctx.instance.id, ctx.session.id, created.run_id, input);
      return c.json({ runId: created.run_id, session });
    } finally {
      starting.delete(key);
    }
  });

  r.get('/sessions/:inst/:id/runs/:runId', async (c) => {
    const ctx = ctxOf(c);
    const runId = runOf(ctx, c.req.param('runId'));
    const settled = await settle(ctx);
    return c.json(publicStatus(settled ?? await status(ctx, runId)));
  });

  r.get('/sessions/:inst/:id/runs/:runId/events', async (c) => {
    const ctx = ctxOf(c);
    const runId = runOf(ctx, c.req.param('runId'));
    const lastEventId = c.req.header('last-event-id');
    let res: Response;
    try {
      res = await streamOp(http(ctx), report(ctx), 'chat', 'runEvents', {
        params: { run_id: runId },
        profile: ctx.profile,
        headers: { Accept: 'text/event-stream', ...(lastEventId && /^\d+$/.test(lastEventId) ? { 'Last-Event-ID': lastEventId } : {}) },
        signal: c.req.raw.signal,
      });
    } catch (err) {
      return sseError(0, (err as Error).message);
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('text/event-stream') || !res.body) {
      await res.body?.cancel();
      return sseError(res.status, res.status === 404 ? 'Run introuvable chez Hermes' : `Hermes a répondu ${res.status}`);
    }
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  });

  r.post('/sessions/:inst/:id/runs/:runId/stop', async (c) => {
    const ctx = ctxOf(c);
    const runId = runOf(ctx, c.req.param('runId'));
    return c.json(await callOp(http(ctx), report(ctx), 'chat', 'stopRun', { params: { run_id: runId }, profile: ctx.profile, body: {} }));
  });

  r.post('/sessions/:inst/:id/runs/:runId/approval', async (c) => {
    const ctx = ctxOf(c);
    const runId = runOf(ctx, c.req.param('runId'));
    const { choice, requestId } = ApprovalBody.parse(await c.req.json());
    const s = await status(ctx, runId);
    if (s.status === 'unknown') return c.json({ error: 'Ce run est terminé', code: 'run_gone' }, 409);
    const built = controlBody('approval', s.raw, requestId ?? null, choice);
    if ('code' in built) return c.json({ error: CONTROL_ERRORS[built.code], code: built.code }, 409);
    return c.json(await callOp(http(ctx), report(ctx), 'chat', 'approval', { params: { run_id: runId }, profile: ctx.profile, body: built.body }));
  });

  /** Answer to a question of the agent; Hermes allows it with its gateway session authority only. */
  r.post('/sessions/:inst/:id/runs/:runId/clarify', async (c) => {
    const ctx = ctxOf(c);
    const runId = runOf(ctx, c.req.param('runId'));
    const { answer, requestId } = ClarifyBody.parse(await c.req.json());
    const unavailable = () => c.json({ error: 'Hermes ne permet pas de répondre à cette question depuis Intendia', code: 'clarify_unavailable' }, 409);
    const s = await status(ctx, runId);
    if (s.status === 'unknown') return c.json({ error: 'Ce run est terminé', code: 'run_gone' }, 409);
    if (typeof RunStatusSchema.safeParse(s.raw).data?.execution_generation !== 'number') return unavailable();
    const built = controlBody('clarify', s.raw, requestId ?? null, answer);
    if ('code' in built) return c.json({ error: CONTROL_ERRORS[built.code], code: built.code }, 409);
    try {
      return c.json(await callOp(http(ctx), report(ctx), 'chat', 'clarify', { params: { run_id: runId }, profile: ctx.profile, body: built.body }));
    } catch (err) {
      // without the authority Hermes answers 409 not_found; an older Hermes has no such route (404)
      if (err instanceof HermesError && err.kind === 'http' && (err.detail.status === 404 || (err.detail.status === 409 && /not_found/.test(err.detail.body ?? '')))) return unavailable();
      throw err;
    }
  });

  // ---- instance-level

  // Models of the chat's picker, per agent, grouped by provider (see chat/models-list.ts).
  r.get('/i/:inst/chat-models', async (c) => {
    const inst = c.req.param('inst');
    const profile = instanceProfile(inst, c.req.query('profile'));
    const managed = chatModelsManaged(compat.get(inst));
    const options = await callOp<z.infer<typeof ModelOptionsSchema>>(compat.http(inst), compat.get(inst), 'chat', 'modelOptions', { profile });
    // read after the options: reading them may write discovered models into the file
    const declared = managed ? await deps.services.config.declaredFor(inst, profile).catch(() => null) : null;
    const out: ChatModelList = { auto: autoModel(options), groups: chatGroups(options, declared), managed };
    return c.json(out);
  });

  r.get('/i/:inst/other-sessions', async (c) => {
    const inst = c.req.param('inst');
    const profile = instanceProfile(inst, c.req.query('profile'));
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') ?? '0', 10) || 0);
    const res = await callOp<{ data: Record<string, unknown>[]; has_more?: boolean }>(compat.http(inst), compat.get(inst), 'sessions', 'list', {
      profile, query: { limit: OTHER_PAGE, offset },
    });
    const owned = workspaces.ownedIds(inst);
    const sessions = res.data.filter((s) => !owned.has(String(s.id))).map((s) => ({
      id: String(s.id), source: (s.source as string | null) ?? null, title: (s.title as string | null) ?? null,
      preview: (s.preview as string | null) ?? null, startedAt: (s.started_at as number | null) ?? null,
      lastActive: (s.last_active as number | null) ?? null, messageCount: (s.message_count as number | null) ?? null,
    }));
    return c.json({ sessions, hasMore: Boolean(res.has_more), nextOffset: offset + OTHER_PAGE });
  });

  r.get('/i/:inst/external/:id/messages', async (c) => {
    const inst = c.req.param('inst');
    const id = c.req.param('id');
    if (!SLUG_RE.test(inst) || !SESSION_ID_RE.test(id)) throw new ValidationError('identifiant invalide');
    const profile = instanceProfile(inst, c.req.query('profile'));
    return c.json({ messages: await messages(inst, id, profile) });
  });

  return r;
}
