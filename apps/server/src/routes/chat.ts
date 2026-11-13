import { PROFILE_RE } from './params.js';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { RunStatusSchema } from '../connectors/chat/index.js';
import { callOp, HermesError, streamOp } from '../connectors/runtime.js';
import type { CompatReport } from '../connectors/types.js';
import { SLUG_RE } from '../workspaces/fs.js';
import { autoModel, chatGroups, chatModelsManaged, type ChatModelList } from '../chat/models-list.js';
import type { ModelOptionsSchema } from '../connectors/chat/index.js';
import { NotFoundError, ValidationError, type RunStatRow, type SessionContext, type WorkspaceService } from '../workspaces/service.js';
import { SESSION_ID_RE, sessionParams } from './workspaces.js';
import { ModelInfoSchema } from '../connectors/config/index.js';
import { sessionStats, type SessionStats } from '../hermes/gateway-ws.js';
import { toUsage } from '../chat/usage.js';
import { readHistory, readRunStatus, type ChatMessage } from '../chat/history.js';
import { listChildren } from '../chat/subagents.js';
import { answerApproval, ApproveError, CONTROL_ERRORS, controlBody } from '../chat/approve.js';
import { presets, Modes, Pins } from '../chat/presets.js';
import { PromptService } from '../prompts/service.js';
import { listPersonalities } from '../sessions/personalities.js';
import { SKILLS_MAX } from '../sessions/run-extras.js';
import { RunBusyError, RunExtrasError, settle as settleRuns, startRun } from '../chat/start-run.js';
import { isReservedText } from '../chat/goal.js';
import { summarize, wakeDecision } from '../chat/wake.js';
import { profileOf } from './skills.js';

export { toChatMessages, type ChatMessage } from '../chat/history.js';
export { controlBody } from '../chat/approve.js';

const RUN_ID_RE = /^run_[A-Za-z0-9]{1,64}$/;
const OTHER_PAGE = 50;

const SendBody = z.object({
  input: z.string().min(1).max(100_000),
  /** `/use <skill>`: put in the instructions of this run only */
  // same names as the skills routes (`category/name` for same-tier duplicates), never a `..` segment
  skills: z.array(z.string().regex(/^[A-Za-z0-9_.:/-]{1,160}$/).refine((n) => !n.split('/').includes('..'))).max(SKILLS_MAX).optional(),
});
const ClarifyBody = z.object({ answer: z.string().min(1).max(16_384), requestId: z.string().max(256).optional() });
const SteerBody = z.object({ input: z.string().trim().min(1).max(16384) });
const ApprovalBody = z.object({ choice: z.enum(['once', 'session', 'always', 'deny']), requestId: z.string().max(256).optional() });

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseError(status: number, message: string): Response {
  return new Response(`: open\n\n${sseFrame({ event: 'intendia.error', status, message })}`, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

const RESERVED = 'Ce début de message est réservé aux messages automatiques d’Intendia';

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

  const status = (ctx: SessionContext, runId: string) => readRunStatus(compat, ctx.instance.id, ctx.profile, runId);
  const publicStatus = ({ raw: _raw, ...s }: Awaited<ReturnType<typeof status>>) => s;

  const history = (instanceId: string, sessionId: string, profile: string, limit?: number) =>
    readHistory(compat, instanceId, sessionId, profile, limit);
  const messages = async (instanceId: string, sessionId: string, profile: string): Promise<ChatMessage[]> =>
    (await history(instanceId, sessionId, profile)).messages;

  const runDeps = deps.services.runDeps;
  const settle = (ctx: SessionContext, opts?: Parameters<typeof settleRuns>[2]) => settleRuns(runDeps, ctx, opts);
  const goals = deps.services.goals;

  const prompts = new PromptService(deps.db);
  const instOf = (c: { req: { param: (k: string) => string | undefined } }) => {
    const id = c.req.param('inst') ?? '';
    if (!deps.store.get(id)) throw new NotFoundError(`Instance inconnue : ${id}`);
    return id;
  };

  r.get('/i/:inst/personalities', async (c) => c.json(await listPersonalities(deps.services.config, prompts, instOf(c), profileOf(c))));
  r.get('/i/:inst/model-pins', (c) => c.json({ pins: presets.pins(deps.db, instOf(c), profileOf(c)) }));
  r.put('/i/:inst/model-pins', async (c) => {
    const inst = instOf(c);
    const pins = Pins.parse((await c.req.json()).pins);
    presets.setPins(deps.db, inst, profileOf(c), pins);
    return c.json({ pins });
  });
  r.get('/i/:inst/modes', (c) => c.json({ modes: presets.modes(deps.db, instOf(c), profileOf(c)) }));
  r.put('/i/:inst/modes', async (c) => {
    const inst = instOf(c);
    const modes = Modes.parse((await c.req.json()).modes);
    presets.setModes(deps.db, inst, profileOf(c), modes);
    return c.json({ modes });
  });

  const publicRun = (r: RunStatRow) => ({
    runId: r.runId, status: r.status, requestedModel: r.requestedModel, requestedEffort: r.requestedEffort,
    servedModel: r.servedModel, startedAt: r.startedAt, endedAt: r.endedAt,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens, cacheWriteTokens: r.cacheWriteTokens,
    costUsd: r.costUsd, costRuns: r.costRuns, costFinal: r.costFinal, autoApproved: r.autoApproved,
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
    // background sub-agents: the server's decision (chat/wake.ts), same window as its watcher
    const { wakes } = deps.services;
    const nowSec = Date.now() / 1000;
    const d = wakeDecision(h.messages, nowSec, wakes.prevChain(ctx.instance.id, ctx.session.id, ctx.session.lastRunId));
    const subagents = summarize(d, d.key ? wakes.get(ctx.instance.id, ctx.session.id, d.key) : null, nowSec);
    return c.json({ messages: h.messages, runs: workspaces.runStats(ctx.instance.id, ctx.session.id).map(publicRun), subagents });
  });

  // sessions of the session's sub-agents (live tracking of background ones)
  r.get('/sessions/:inst/:id/subagents', async (c) => c.json({ children: await listChildren(compat, ctxOf(c)) }));

  // one run creation at a time per session (chat/start-run.ts)
  r.post('/sessions/:inst/:id/runs', async (c) => {
    const ctx = ctxOf(c);
    const { input, skills } = SendBody.parse(await c.req.json());
    if (isReservedText(input)) return c.json({ error: RESERVED, code: 'reserved_prefix' }, 400);
    // the user writes: an active goal pauses first, so this run goes without the goal's block
    goals.pauseIfActive(ctx.instance.id, ctx.session.id, 'user');
    try {
      return c.json(await startRun(runDeps, ctx, input, { skills }));
    } catch (err) {
      if (err instanceof RunBusyError) return c.json({ error: err.message }, 409);
      if (err instanceof RunExtrasError) return c.json({ error: err.message, code: err.code }, err.status);
      throw err;
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
    try {
      return c.json(await answerApproval(compat, ctx, runId, choice, requestId ?? null));
    } catch (err) {
      if (err instanceof ApproveError) return c.json({ error: err.message, code: err.code }, 409);
      throw err;
    }
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

  // Context gauge and plan quota: the model's context size by HTTP; exact figures and quota only from the dashboard
  // WebSocket (`session.stats`), when the compat check found it. Every failure gives null figures, never an error.
  r.get('/sessions/:inst/:id/usage', async (c) => {
    const ctx = ctxOf(c);
    const info = await callOp<z.infer<typeof ModelInfoSchema>>(http(ctx), report(ctx), 'config', 'modelInfo', { profile: ctx.profile })
      .then((v) => ModelInfoSchema.parse(v)).catch(() => null);
    let stats: SessionStats | null = null;
    if (report(ctx)?.socket?.sessionStats) {
      const live = await history(ctx.instance.id, ctx.session.id, ctx.profile, 1).catch(() => null);
      if (live?.exists) stats = await sessionStats(ctx.instance, live.liveId, { factory: deps.wsFactory ?? compat.wsFactory }).catch(() => null);
    }
    return c.json(toUsage(stats, info, { model: ctx.session.model }));
  });

  // Reorientation: the text reaches the agent after its current batch of tools, without stopping the run. Hermes
  // only takes it while the run is exactly `running` (not during an approval): otherwise 409.
  r.post('/sessions/:inst/:id/runs/:runId/steer', async (c) => {
    const ctx = ctxOf(c);
    const runId = runOf(ctx, c.req.param('runId'));
    const { input } = SteerBody.parse(await c.req.json());
    if (isReservedText(input)) return c.json({ error: RESERVED, code: 'reserved_prefix' }, 400);
    try {
      const res = await callOp(http(ctx), report(ctx), 'chat', 'steer', { params: { run_id: runId }, profile: ctx.profile, body: { input } });
      // a reorientation is the user writing: an active goal pauses
      goals.pauseIfActive(ctx.instance.id, ctx.session.id, 'user');
      return c.json(res);
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http' && (err.detail.status === 409 || err.detail.status === 404)) {
        return c.json({ error: 'L’agent n’accepte pas de réorientation maintenant', code: 'steer_refused' }, 409);
      }
      throw err;
    }
  });

  // ---- instance-level

  // Models of the chat's picker, per agent, grouped by provider (see chat/models-list.ts).
  r.get('/i/:inst/chat-models', async (c) => {
    const inst = c.req.param('inst');
    // ?for=agent: the default model of any agent (Agents page), even one Intendia cannot chat with
    // (read on the dashboard: no API server key needed)
    const raw = c.req.query('profile');
    const forAgent = c.req.query('for') === 'agent' && Boolean(raw && PROFILE_RE.test(raw) && deps.store.get(inst));
    const profile = forAgent ? raw! : instanceProfile(inst, raw);
    const managed = chatModelsManaged(compat.get(inst));
    const options = await callOp<z.infer<typeof ModelOptionsSchema>>(compat.http(inst), compat.get(inst), forAgent ? 'config' : 'chat', 'modelOptions', { profile });
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

  // a session born elsewhere (Telegram, CLI, cron…): deleted at Hermes now, no undo (the web confirms first).
  // Never an Intendia session nor what continues one after compression: those go through the deletion with undo.
  r.delete('/i/:inst/external/:id', async (c) => {
    const inst = c.req.param('inst');
    const id = c.req.param('id');
    if (!SLUG_RE.test(inst) || !SESSION_ID_RE.test(id)) throw new ValidationError('identifiant invalide');
    const profile = instanceProfile(inst, c.req.query('profile'));
    const owned = workspaces.ownedIds(inst);
    if (owned.has(id)) return c.json({ error: 'Session d’Intendia : passez par la suppression avec annulation', code: 'owned' }, 409);
    const gone = (err: unknown) => err instanceof HermesError && err.kind === 'http' && err.detail.status === 404;
    let session: Record<string, unknown>;
    try {
      session = await callOp<Record<string, unknown>>(compat.http(inst), compat.get(inst), 'sessions', 'get', { params: { session_id: id }, profile });
    } catch (err) {
      if (gone(err)) return c.json({ ok: true });
      throw err;
    }
    if (session.is_internal_child === true) {
      return c.json({ error: 'Session de sous-agent : supprimez la session parente', code: 'child' }, 409);
    }
    if ([session.parent_session_id, session._lineage_root_id].some((p) => typeof p === 'string' && owned.has(p))) {
      return c.json({ error: 'Cette session continue une session d’Intendia après compression : supprimez la session d’origine dans Intendia', code: 'owned' }, 409);
    }
    try {
      await callOp(compat.http(inst), compat.get(inst), 'sessions', 'remove', { params: { session_id: id }, profile });
    } catch (err) {
      if (gone(err)) return c.json({ ok: true });
      if (err instanceof HermesError && err.kind === 'http' && err.detail.status === 409 && /session_active_turn/.test(err.detail.body ?? '')) {
        return c.json({ error: 'Un tour est en cours dans cette session : réessayez quand il est fini', code: 'run_active' }, 409);
      }
      throw err;
    }
    return c.json({ ok: true });
  });

  return r;
}
