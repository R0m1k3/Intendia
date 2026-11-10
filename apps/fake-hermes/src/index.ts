/**
 * Fake Hermes: replays a probe recording (fixtures/hermes-<version>/) on two Hono apps,
 * the API server and the dashboard, and simulates runs (SSE events with seq and resume).
 * Used for front-end development and CI, without Hermes nor an AI provider key.
 * `breaks` simulates an incompatible Hermes release.
 *
 * Run scenarios, chosen by words in the run input:
 * - default: run.started, two message.delta, tool.started, tool.completed, run.completed
 * - "approval": stops on approval.request until POST /v1/runs/{id}/approval
 * - "echec": tool.failed instead of tool.completed
 * - "lent": one event every 500 ms for 10 s (resume tests by hand)
 * - "panne": the run ends in `failed` (run.failed, no usage)
 * - "cher": large token counts in `usage` (k / M formats)
 * Completed runs carry `usage`, `runtime` and `updated_at`; each one adds 0.0123 $ to its session's
 * `estimated_cost_usd` (null before). `GET /_fake/runs/last` (no token) = model options and input of the last run.
 * Cron jobs: see crons.ts (in-memory store, scenarios "bloque" and "long" in the job prompt).
 * Skills: see skills.ts (in-memory list, hub, background actions; "lent" in a hub search delays it).
 * Profiles: see profiles.ts; kanban: see kanban.ts (workers, dispatch, terminate).
 * - "delegue": two sub-agents (subagent.start / subagent.complete), the second a child of the first
 *
 * - "fichier" (in the input): writes rapport.md in the session folder named by the framing block,
 *   translated by `pathMap` (agent path → local folder), then cites its path
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CronStore } from './crons.js';
import { KanbanStore } from './kanban.js';
import { ProfileStore } from './profiles.js';
import { ConfigStore } from './config.js';
export { OPENROUTER_MODELS } from './config.js';
import { SkillStore } from './skills.js';

export const FAKE_API_KEY = 'fake-api-key-000000000000';
export const FAKE_DASH_TOKEN = 'fake-dashboard-token';

export interface Break {
  /** HTTP status to answer instead of the fixture (e.g. 404, 500). */
  status?: number;
  /** Replaces the fixture body (e.g. a renamed field). */
  body?: unknown;
}

export interface FakeOptions {
  fixturesDir: string;
  /** Keyed by "api GET /path" or "dash GET /path" (paths without the /p/<profile> prefix). */
  breaks?: Record<string, Break>;
  /** Hide entries of /v1/capabilities `endpoints` or dashboard OpenAPI routes ("METHOD /path"). */
  hide?: { capabilities?: string[]; openapi?: string[] };
  /** Multi-profile routing: /p/<profile>/... on the API server requires that profile's key. */
  profileKeys?: Record<string, string>;
  /** Events with seq < retainFrom are forgotten: an older resume first gets replay.truncated. */
  retainFrom?: number;
  /** Delay between simulated events, in ms (default 5; "lent" scenario: 500). */
  stepMs?: number;
  /** Step of simulated cron runs, in ms (default: stepMs). */
  cronStepMs?: number;
  /** Duration of a simulated skills action (install, uninstall, update), in ms (default: stepMs). */
  skillStepMs?: number;
  /** Step of a simulated gateway restart (3 steps), in ms (default: stepMs). */
  configStepMs?: number;
  /** Duration of a simulated kanban worker, in ms (default: stepMs). */
  kanbanStepMs?: number;
  /** "fichier" scenario: the agent's view of the volume (`from`) is the local folder `to`. */
  pathMap?: { from: string; to: string };
  /** Kanban events WebSocket available (default true); false closes every connection with 1008. */
  kanbanWs?: boolean;
}

export interface LoggedRequest {
  via: Via;
  method: string;
  /** Path without the /p/<profile> prefix. */
  path: string;
  profile: string;
  authorization: string | undefined;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

/** Must match apps/server/src/cli/fixtures.ts (checked by a server test). */
export function fixtureName(method: string, path: string): string {
  return `${method.toUpperCase()}${path.replace(/[^A-Za-z0-9]+/g, '_')}.json`;
}

type Via = 'api' | 'dash';

function load(dir: string, via: Via, method: string, path: string): { status: number; body: unknown } | null {
  const file = join(dir, via, path === '/openapi.json' ? 'openapi.json' : fixtureName(method, path));
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return path === '/openapi.json' ? { status: 200, body: raw } : raw;
}

// ---------------------------------------------------------------- simulated runs

type Ev = Record<string, unknown> & { event: string };

interface SimRun {
  id: string;
  sessionId: string;
  input: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  modelOptions: unknown;
  status: string;
  output: string;
  usage: Record<string, number> | null;
  events: (Ev & { seq: number })[];
  listeners: Set<() => void>;
  approval: { resolve: (choice: string) => void } | null;
}

interface SimMessage {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_calls: unknown;
  tool_name: string | null;
  timestamp: number;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Simulator {
  runs = new Map<string, SimRun>();
  messages = new Map<string, SimMessage[]>();
  /** Cumulated cost per session (estimated_cost_usd), absent = null. */
  costs = new Map<string, number>();
  lastRun: SimRun | null = null;
  /** Tests: session id → live session id reported by /messages (simulates a context compression). */
  liveAlias = new Map<string, string>();
  /** Tests: sessions born elsewhere (Telegram, cron…) added by POST /_fake/sessions. */
  extraSessions = new Map<string, { id: string; source: string | null; title: string | null; started_at: number }>();
  /** Session titles set by PATCH /api/sessions/{id}. */
  titles = new Map<string, string>();
  /** POST /v1/runs received since start. */
  runsPosted = 0;
  private counter = 0;
  private msgId = 1000;

  constructor(private readonly stepMs: number, private readonly pathMap?: { from: string; to: string }) {}

  create(sessionId: string, input: string, instructions = '', model: string | null = null, modelOptions: unknown = null): SimRun {
    this.counter += 1;
    const now = Date.now() / 1000;
    const run: SimRun = {
      id: `run_fake${String(this.counter).padStart(4, '0')}`,
      sessionId, input, instructions, createdAt: now, updatedAt: now, model, modelOptions, status: 'queued', output: '', usage: null,
      events: [], listeners: new Set(), approval: null,
    };
    this.runs.set(run.id, run);
    this.lastRun = run;
    this.addMessage(sessionId, 'user', input);
    void this.play(run);
    return run;
  }

  addMessage(sessionId: string, role: string, content: string, extra: Partial<SimMessage> = {}) {
    const list = this.messages.get(sessionId) ?? [];
    this.msgId += 1;
    list.push({ id: this.msgId, session_id: sessionId, role, content, tool_calls: null, tool_name: null, timestamp: Date.now() / 1000, ...extra });
    this.messages.set(sessionId, list);
  }

  private push(run: SimRun, ev: Ev) {
    const seq = run.events.length;
    run.updatedAt = Date.now() / 1000;
    run.events.push({ ...ev, run_id: run.id, timestamp: Date.now() / 1000, seq });
    for (const l of run.listeners) l();
  }

  private async play(run: SimRun) {
    const slow = /lent/i.test(run.input);
    const step = slow ? 500 : this.stepMs;
    await sleep(step);
    run.status = 'running';
    this.push(run, { event: 'run.started' });
    if (slow) {
      for (let i = 0; i < 18; i++) {
        await sleep(step);
        this.push(run, { event: 'message.delta', delta: `${i + 1}… ` });
      }
    }
    if (/approval/i.test(run.input)) {
      run.status = 'waiting_for_approval';
      const choice = await new Promise<string>((resolve) => {
        run.approval = { resolve };
        this.push(run, {
          event: 'approval.request', request_id: 'apr_1', command: 'rm -rf build/', description: 'Supprimer le dossier build',
          choices: ['once', 'session', 'always', 'deny'],
        });
      });
      run.approval = null;
      run.status = 'running';
      this.push(run, { event: 'approval.responded', choice, request_id: 'apr_1', resolved: 1 });
      if (choice === 'deny') {
        await sleep(step);
        return this.finish(run, 'Commande refusée, je m’arrête là.');
      }
    }
    if (/panne/i.test(run.input)) {
      await sleep(step);
      this.push(run, { event: 'message.delta', delta: 'Je commence…' });
      await sleep(step);
      return this.fail(run, 'Provider error: model unavailable');
    }
    if (/fichier/i.test(run.input)) return this.playFile(run, step);
    if (/delegue/i.test(run.input)) return this.playDelegate(run, step);
    await sleep(step);
    this.push(run, { event: 'message.delta', delta: 'Je regarde ' });
    await sleep(step);
    this.push(run, { event: 'message.delta', delta: 'le dossier.' });
    await sleep(step);
    this.push(run, { event: 'tool.started', tool: 'terminal', preview: 'ls -la', call_id: 'call_1' });
    await sleep(step);
    if (/echec/i.test(run.input)) {
      this.push(run, { event: 'tool.failed', tool: 'terminal', duration: 0.2, error: true, preview: 'ls: permission denied', call_id: 'call_1' });
    } else {
      this.push(run, { event: 'tool.completed', tool: 'terminal', duration: 0.42, error: false, preview: 'AGENTS.md\nfiles\ninbox\nsessions', call_id: 'call_1' });
    }
    this.addMessage(run.sessionId, 'tool', 'AGENTS.md\nfiles\ninbox\nsessions', { tool_name: 'terminal' });
    await sleep(step);
    this.finish(run, 'Je regarde le dossier. Il contient `AGENTS.md`, `files`, `inbox` et `sessions`.');
  }

  private async playFile(run: SimRun, step: number) {
    const dir = /dans (\S+\/sessions\/[^/\s]+)\/\./.exec(run.instructions)?.[1] ?? '/workspace/sessions/inconnue';
    const path = `${dir}/rapport.md`;
    const map = this.pathMap;
    if (map && path.startsWith(`${map.from}/`)) {
      const local = `${map.to}${path.slice(map.from.length)}`;
      mkdirSync(local.slice(0, local.lastIndexOf('/')), { recursive: true });
      writeFileSync(local, '# Rapport\n\nFichier écrit par fake-hermes.\n\n| Magasin | Ventes |\n|---|---|\n| Frouard | 1 240 |\n| Houdemont | 980 |\n');
    }
    await sleep(step);
    this.push(run, { event: 'tool.started', tool: 'write_file', preview: path, call_id: 'call_1' });
    await sleep(step);
    this.push(run, { event: 'tool.completed', tool: 'write_file', duration: 0.05, error: false, preview: path, call_id: 'call_1' });
    this.addMessage(run.sessionId, 'tool', `Wrote ${path}`, { tool_name: 'write_file' });
    await sleep(step);
    this.finish(run, `Voilà le rapport : \`${path}\`. Il reprend les ventes des deux magasins.`);
  }

  /** "delegue" scenario: two sub-agents, the second one a child of the first. */
  private async playDelegate(run: SimRun, step: number) {
    const base = { task_count: 1, task_index: 0, model: 'fake/model-mini' };
    this.push(run, { event: 'subagent.start', ...base, subagent_id: 'sa_1', depth: 1, goal: 'Lire les ventes de Frouard', preview: 'Lire les ventes de Frouard' });
    await sleep(step);
    this.push(run, { event: 'subagent.start', ...base, subagent_id: 'sa_2', parent_id: 'sa_1', depth: 2, goal: 'Calculer le total par rayon' });
    await sleep(step * 2);
    this.push(run, {
      event: 'subagent.complete', ...base, subagent_id: 'sa_2', parent_id: 'sa_1', depth: 2, status: 'completed',
      summary: 'Total : 1 240 €.', duration_seconds: 2.4, cost_usd: 0.0031, input_tokens: 820, output_tokens: 64, tool_count: 1,
    });
    await sleep(step);
    this.push(run, {
      event: 'subagent.complete', ...base, subagent_id: 'sa_1', depth: 1, status: 'completed',
      summary: 'Ventes de Frouard lues.', duration_seconds: 4.1, cost_usd: 0.0123, input_tokens: 2100, output_tokens: 180, tool_count: 3,
    });
    await sleep(step);
    this.finish(run, 'Les deux sous-agents ont fini : 1 240 € de ventes à Frouard.');
  }

  private finish(run: SimRun, output: string) {
    const big = /cher/i.test(run.input);
    const input = big ? 1_250_000 : 12_000;
    const output_tokens = big ? 5_200 : 800;
    run.usage = {
      input_tokens: input, output_tokens, total_tokens: input + output_tokens,
      cache_read_tokens: big ? 1_000_000 : 9_000, cache_write_tokens: big ? 200_000 : 500,
    };
    run.status = 'completed';
    run.output = output;
    this.costs.set(run.sessionId, Math.round(((this.costs.get(run.sessionId) ?? 0) + 0.0123) * 1e6) / 1e6);
    this.addMessage(run.sessionId, 'assistant', output);
    this.push(run, { event: 'run.completed', output, usage: run.usage, runtime: this.runtime(run) });
  }

  runtime(run: SimRun) {
    return { provider: 'fake', model: run.model ?? 'fake/model-default' };
  }

  private fail(run: SimRun, error: string) {
    run.status = 'failed';
    this.push(run, { event: 'run.failed', error });
  }

  stop(run: SimRun) {
    if (TERMINAL.has(run.status)) return;
    run.status = 'cancelled';
    run.approval?.resolve('deny');
    this.push(run, { event: 'run.cancelled' });
  }

  /** SSE stream with Hermes framing: `id: <seq>` + `data: <json>`, resume after `lastSeq`. */
  stream(run: SimRun, lastSeq: number, retainFrom: number): Response {
    const enc = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let sent = lastSeq;
        let closed = false;
        const write = (s: string) => { if (!closed) controller.enqueue(enc.encode(s)); };
        const close = () => {
          if (closed) return;
          write(': stream closed\n\n');
          closed = true;
          run.listeners.delete(flush);
          controller.close();
        };
        const flush = () => {
          for (const ev of run.events) {
            if (ev.seq <= sent || ev.seq < retainFrom) continue;
            write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
            sent = ev.seq;
          }
          if (TERMINAL.has(run.status) && sent >= run.events.length - 1) close();
        };
        write(': open\n\n');
        if (retainFrom > 0 && lastSeq + 1 < retainFrom && run.events.length > 0) {
          write(`data: ${JSON.stringify({ event: 'replay.truncated', run_id: run.id, oldest_retained_seq: retainFrom, requested_seq: lastSeq })}\n\n`);
        }
        run.listeners.add(flush);
        cleanup = () => { closed = true; run.listeners.delete(flush); };
        flush();
      },
      cancel: () => cleanup(),
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }
}

// ---------------------------------------------------------------- apps

interface Stores { crons: CronStore; skills: SkillStore; config: ConfigStore; profiles: ProfileStore; kanban: KanbanStore }

function makeApp(via: Via, opts: FakeOptions, sim: Simulator, stores: Stores, log: LoggedRequest[]): Hono {
  const { crons, skills, config, profiles, kanban } = stores;
  const app = new Hono();
  const deleted = new Set<string>();

  app.all('*', async (c) => {
    const method = c.req.method;
    let path = c.req.path;
    let profile = 'default';
    const m = via === 'api' ? /^\/p\/([^/]+)(\/.*)$/.exec(path) : null;
    if (m) {
      profile = decodeURIComponent(m[1]!);
      path = m[2]!;
    }
    let body: unknown;
    if (method !== 'GET' && method !== 'HEAD') body = await c.req.json().catch(() => undefined);
    log.push({
      via, method, path, profile, authorization: c.req.header('authorization'),
      query: c.req.query(), headers: Object.fromEntries(c.req.raw.headers), body,
    });

    // test route (Playwright runs cannot read the in-memory log): options of the last created run
    if (via === 'api' && method === 'GET' && path === '/_fake/runs/last') {
      const last = sim.lastRun;
      return c.json(last ? { run_id: last.id, model: last.model, model_options: last.modelOptions, input: last.input } : { run_id: null });
    }
    if (via === 'api' && method === 'GET' && path === '/_fake/runs/count') return c.json({ count: sim.runsPosted });
    if (via === 'api' && method === 'POST' && path === '/_fake/sessions') {
      const b = (body ?? {}) as Record<string, unknown>;
      const id = typeof b.id === 'string' ? b.id : `fake_extra_${sim.extraSessions.size + 1}`;
      sim.extraSessions.set(id, {
        id, source: typeof b.source === 'string' ? b.source : null, title: typeof b.title === 'string' ? b.title : null,
        started_at: typeof b.started_at === 'number' ? b.started_at : Date.now() / 1000,
      });
      return c.json({ id });
    }
    const titleMatch = /^\/_fake\/sessions\/([^/]+)\/title$/.exec(path);
    if (via === 'api' && method === 'GET' && titleMatch) return c.json({ title: sim.titles.get(decodeURIComponent(titleMatch[1]!)) ?? null });
    if (path !== '/health') {
      const token = via === 'dash' ? FAKE_DASH_TOKEN : profile === 'default' ? FAKE_API_KEY : opts.profileKeys?.[profile];
      if (!token || c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthorized' }, 401);
    }

    const key = `${via} ${method} ${path}`;
    const brk = opts.breaks?.[key];
    if (brk?.status) return c.json(brk.body ?? { error: 'broken by fake-hermes' }, brk.status as 404);
    if (brk && 'body' in brk) return c.json(brk.body as object);

    const prof = profiles.handle(via, method, path, body);
    if (prof) return prof;
    const kb = kanban.handle(via, method, path, c.req.query(), body);
    if (kb) return kb;
    const cron = crons.handle(via, method, path, c.req.query(), body, profile);
    if (cron) return cron;
    // before skills: SkillStore answers every /api/actions/{name}/status (404 for unknown actions)
    const conf = config.handle(via, method, path, c.req.query(), body, profile);
    if (conf) return conf;
    const skill = await skills.handle(via, method, path, c.req.query(), body);
    if (skill) return skill;

    if (via === 'api') {
      const simulated = handleRuns(c.req.raw, method, path, body, sim, opts, deleted);
      if (simulated) return simulated;
    }

    const fx = load(opts.fixturesDir, via, method, path);
    if (fx) {
      let out = fx.body;
      if (via === 'api' && path === '/v1/capabilities' && opts.hide?.capabilities?.length) {
        const caps = structuredClone(out) as { endpoints?: Record<string, unknown> };
        for (const k of opts.hide.capabilities) delete caps.endpoints?.[k];
        out = caps;
      }
      if (via === 'dash' && path === '/openapi.json' && opts.hide?.openapi?.length) {
        const spec = structuredClone(out) as { paths: Record<string, Record<string, unknown>> };
        for (const r of opts.hide.openapi) {
          const [mm, p] = [r.slice(0, r.indexOf(' ')).toLowerCase(), r.slice(r.indexOf(' ') + 1)];
          delete spec.paths[p]?.[mm];
        }
        out = spec;
      }
      return c.json(out as object, fx.status as 200);
    }
    // Writes have no recording: acknowledge them so UI flows can be exercised.
    if (method !== 'GET') return c.json({ ok: true, fake: true });
    return c.json({ error: 'not recorded' }, 404);
  });
  return app;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

const NOT_FOUND_SESSION = (id: string) => json({ error: { message: `Session not found: ${id}`, code: 'session_not_found' } }, 404);

/** Simulated run and session routes of the API server; null = not handled here. */
function handleRuns(req: Request, method: string, path: string, body: unknown, sim: Simulator, opts: FakeOptions, deleted: Set<string>): Response | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === 'POST' && path === '/v1/runs') {
    sim.runsPosted += 1;
    const sessionId = typeof b.session_id === 'string' ? b.session_id : `fake_session_${sim.runs.size + 1}`;
    const run = sim.create(sessionId, String(b.input ?? ''), String(b.instructions ?? ''),
      typeof b.model === 'string' ? b.model : null, b.model_options ?? null);
    return json({ run_id: run.id, status: 'started', replayed: false });
  }
  let m = /^\/v1\/runs\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (m) {
    const run = sim.runs.get(decodeURIComponent(m[1]!));
    const sub = m[2];
    if (!run) return json({ error: { message: 'Run not found', code: 'run_not_found' } }, 404);
    if (!sub && method === 'GET') {
      // like Hermes: usage and runtime only on completed runs
      return json({
        object: 'hermes.run', run_id: run.id, status: run.status, session_id: run.sessionId, model: run.model ?? 'fake/model-default',
        created_at: run.createdAt, updated_at: run.updatedAt, output: run.output,
        ...(run.status === 'completed' ? { usage: run.usage, runtime: sim.runtime(run) } : {}), pending_controls: [],
      });
    }
    if (sub === '/events' && method === 'GET') {
      const url = new URL(req.url);
      const raw = req.headers.get('last-event-id') ?? url.searchParams.get('last_seq');
      const last = raw === null ? -1 : Math.max(-1, Number.parseInt(raw, 10) || -1);
      return sim.stream(run, last, opts.retainFrom ?? 0);
    }
    if (sub === '/stop' && method === 'POST') {
      sim.stop(run);
      return json({ object: 'hermes.run.stop', run_id: run.id, status: 'stopping' });
    }
    if (sub === '/approval' && method === 'POST') {
      if (!run.approval) return json({ error: { message: 'No pending approval', code: 'no_pending_approval' } }, 409);
      const choice = String(b.choice ?? 'deny');
      run.approval.resolve(choice);
      return json({ object: 'hermes.run.approval_response', run_id: run.id, choice, resolved: 1 });
    }
    return null;
  }
  if (method === 'GET' && path === '/api/sessions') {
    const fx = load(opts.fixturesDir, 'api', 'GET', '/api/sessions');
    const recorded = ((fx?.body as { data?: { id: string }[] } | undefined)?.data ?? []).filter((s) => !deleted.has(s.id));
    const simulated = [...sim.messages.entries()]
      .filter(([id]) => !recorded.some((s) => s.id === id))
      .map(([id, list]) => ({ id, source: 'api_server', title: sim.titles.get(id) ?? null, started_at: list[0]!.timestamp, message_count: list.length }));
    const extra = [...sim.extraSessions.values()].map((e) => ({ ...e, message_count: 0 }));
    const all = [...simulated, ...extra].sort((a, b) => b.started_at - a.started_at).concat(recorded as never[]);
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return json({ object: 'list', data: all.slice(offset, offset + limit), limit, offset, has_more: offset + limit < all.length });
  }
  m = /^\/api\/sessions\/([^/]+)(\/messages)?$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    const simulated = sim.messages.get(id);
    if (deleted.has(id)) return NOT_FOUND_SESSION(id);
    if (m[2] && method === 'GET' && !simulated && sim.extraSessions.has(id)) {
      return json({ object: 'list', session_id: id, data: [], pagination: { limit: 500, offset: 0, order: 'latest', returned: 0 } });
    }
    if (m[2] && method === 'GET') {
      if (!simulated) return id === 'intendia-probe-1' ? null : NOT_FOUND_SESSION(id);
      return json({
        object: 'list', session_id: sim.liveAlias.get(id) ?? id,
        data: [{ id: 1, session_id: id, role: 'session_meta', content: null, tool_calls: null, tool_name: null, timestamp: simulated[0]!.timestamp }, ...simulated].reverse(),
        pagination: { limit: 500, offset: 0, order: 'latest', returned: simulated.length + 1 },
      });
    }
    if (!m[2] && (method === 'PATCH' || method === 'DELETE')) {
      if (!simulated && id !== 'intendia-probe-1') return NOT_FOUND_SESSION(id);
      if (method === 'DELETE') {
        deleted.add(id);
        sim.messages.delete(id);
        return json({ object: 'hermes.session.deleted', id, deleted: true });
      }
      if (typeof b.title === 'string') sim.titles.set(id, b.title);
      return json({ object: 'hermes.session', session: { id, ...b } });
    }
    if (!m[2] && method === 'GET' && simulated) {
      return json({ object: 'hermes.session', session: {
        id, source: 'api_server', title: sim.titles.get(id) ?? null, started_at: simulated[0]!.timestamp, message_count: simulated.length,
        estimated_cost_usd: sim.costs.get(id) ?? null, actual_cost_usd: null,
      } });
    }
    return null;
  }
  return null;
}

export function createFakeHermes(opts: FakeOptions) {
  const sim = new Simulator(opts.stepMs ?? 5, opts.pathMap);
  const crons = new CronStore(opts.cronStepMs ?? opts.stepMs ?? 5, sim);
  const skills = new SkillStore(opts.fixturesDir, opts.skillStepMs ?? opts.stepMs ?? 5);
  const config = new ConfigStore(opts.fixturesDir, opts.configStepMs ?? opts.stepMs ?? 5);
  const profiles = new ProfileStore(opts.fixturesDir);
  const kanban = new KanbanStore(opts.fixturesDir, opts.kanbanStepMs ?? opts.stepMs ?? 5, () => profiles.names(), opts.pathMap);
  const stores: Stores = { crons, skills, config, profiles, kanban };
  const requests: LoggedRequest[] = [];
  return {
    api: makeApp('api', opts, sim, stores, requests), dash: makeApp('dash', opts, sim, stores, requests),
    requests, sim, crons, skills, config, profiles, kanban,
    /** Can be switched at run time by tests. */
    kanbanWs: opts.kanbanWs ?? true,
  };
}

type Fake = ReturnType<typeof createFakeHermes>;

/** Like Hermes 0.23.0, a wrong token gets no answer to its handshake (neither open nor close). */
export function kanbanWsTokenOk(url: string): boolean {
  return new URL(url, 'ws://fake-dash').searchParams.get('token') === FAKE_DASH_TOKEN;
}

/**
 * One connection to `/api/plugins/kanban/events?board=&since=&token=` (token already checked with
 * `kanbanWsTokenOk`), whatever the transport: `{events, cursor}` messages for the board; unknown board or
 * `kanbanWs: false` → close 1008. Returns the function that ends the subscription.
 */
export function connectKanbanEvents(fake: Fake, url: string, io: { send: (text: string) => void; close: (code: number) => void }): () => void {
  const u = new URL(url, 'ws://fake-dash');
  const board = u.searchParams.get('board') ?? 'default';
  if (!fake.kanbanWs || u.pathname !== '/api/plugins/kanban/events' || !kanbanWsTokenOk(url)
    || !fake.kanban.boards.get(board) || fake.kanban.boards.get(board)!.archived) {
    io.close(1008);
    return () => {};
  }
  const since = u.searchParams.get('since');
  let cursor = since && /^\d+$/.test(since) ? Number(since) : fake.kanban.latestEvent(board);
  return fake.kanban.subscribe((b) => {
    if (b !== board) return;
    const events = fake.kanban.eventsSince(board, cursor);
    if (!events.length) return;
    cursor = events.at(-1)!.id;
    io.send(JSON.stringify({ events, cursor }));
  });
}

/** WebSocket-like factory for tests (same shape as the server's `WsFactory`), backed by `connectKanbanEvents`. */
export function fakeWebSocketFactory(fake: Fake) {
  return (url: string) => {
    const listeners = new Map<string, ((ev: { data?: unknown; code?: number }) => void)[]>();
    const fire = (type: string, ev: { data?: unknown; code?: number } = {}) => { for (const l of listeners.get(type) ?? []) l(ev); };
    let open = true;
    let stop = () => {};
    const end = (code: number) => {
      if (!open) return;
      open = false;
      stop();
      fire('close', { code });
    };
    queueMicrotask(() => {
      if (!kanbanWsTokenOk(url)) return; // handshake left unanswered
      fire('open');
      stop = connectKanbanEvents(fake, url, { send: (data) => { if (open) fire('message', { data }); }, close: end });
    });
    return {
      addEventListener(type: string, l: (ev: { data?: unknown; code?: number }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), l]);
      },
      close: (code = 1000) => end(code),
      /** test helper: is the connection still open? */
      get isOpen() { return open; },
    };
  };
}

/**
 * fetch implementation routing http://fake-api/... and http://fake-dash/... to the in-memory apps
 * (no sockets, for tests).
 */
export function fakeFetch(fake: ReturnType<typeof createFakeHermes>) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const app = url.hostname === 'fake-api' ? fake.api : url.hostname === 'fake-dash' ? fake.dash : null;
    if (!app) throw new TypeError(`fetch failed: unknown host ${url.hostname}`);
    return app.fetch(new Request(url, init));
  };
}
