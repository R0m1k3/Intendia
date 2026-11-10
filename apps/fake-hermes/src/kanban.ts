/**
 * Simulated kanban plugin (dashboard /api/plugins/kanban/*), shapes of Hermes 0.23.0 (checked 2026-11-10).
 * One store for every profile, like Hermes. Behaviour kept from Hermes:
 * - POST /tasks without `triage: true` creates a `ready` task; `running` cannot be set by hand;
 * - `done` is refused while a parent is not done;
 * - POST /dispatch turns each assigned `ready` task into `running` with an active worker; after `stepMs`
 *   the task is `done` and the worker gone; a `dir` workspace is created through `pathMap`;
 * - POST /runs/{id}/terminate ends the worker and puts the task back in `ready` (Hermes relaunches it);
 * - specify / decompose answer {ok:false} (no auxiliary model) unless the title contains "preciser".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Task = Record<string, unknown> & {
  id: string; title: string; status: string; assignee: string | null; body: string | null;
  workspace_kind: string; workspace_path: string | null; created_at: number;
};
interface Board {
  slug: string; name: string; archived: boolean; created_at: number | null;
  tasks: Task[]; comments: { id: number; task_id: string; author: string; body: string; created_at: number }[];
  links: { parent: string; child: string }[];
  attachments: { id: number; task_id: string; filename: string; content_type: string; data: Uint8Array<ArrayBuffer> }[];
  events: { id: number; task_id: string | null; run_id: number | null; kind: string; payload: unknown; created_at: number }[];
}
interface Worker {
  run_id: number; task_id: string; board: string; task_title: string; task_assignee: string | null; profile: string | null;
  worker_pid: number; started_at: number; timer?: NodeJS.Timeout;
}

const now = () => Math.floor(Date.now() / 1000);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fixture(dir: string, name: string): unknown {
  const file = join(dir, 'dash', name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).body : null;
}

export class KanbanStore {
  boards = new Map<string, Board>();
  workers = new Map<number, Worker>();
  workflow: { columns: { key: string }[]; manual: Record<string, string[]> };
  orchestration: Record<string, unknown>;
  private taskSeq = 0;
  private runSeq = 0;
  private eventSeq = 0;
  private attachSeq = 0;
  private listeners = new Set<(board: string) => void>();

  constructor(
    fixturesDir: string,
    private readonly stepMs: number,
    private readonly profiles: () => string[],
    private readonly pathMap?: { from: string; to: string },
  ) {
    this.workflow = (fixture(fixturesDir, 'GET_api_plugins_kanban_workflow.json') as KanbanStore['workflow'])
      ?? { columns: [], manual: {} };
    this.orchestration = (fixture(fixturesDir, 'GET_api_plugins_kanban_orchestration.json') as Record<string, unknown>) ?? {};
    this.boards.set('default', this.newBoard('default', 'Default', null));
  }

  private newBoard(slug: string, name: string, created: number | null): Board {
    return { slug, name, archived: false, created_at: created, tasks: [], comments: [], links: [], events: [], attachments: [] };
  }

  /** Called after every change of a board (WebSocket /events). */
  subscribe(listener: (board: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test helper: a file attached to a task (Hermes stores uploads under the board's attachments root). */
  addAttachment(board: string, taskId: string, filename: string, data: string, contentType = 'text/plain'): number {
    const b = this.boards.get(board)!;
    this.attachSeq += 1;
    b.attachments.push({ id: this.attachSeq, task_id: taskId, filename, content_type: contentType, data: new TextEncoder().encode(data) });
    return this.attachSeq;
  }

  eventsSince(board: string, cursor: number) {
    return this.boards.get(board)?.events.filter((e) => e.id > cursor) ?? [];
  }

  latestEvent(board: string): number {
    return this.boards.get(board)?.events.at(-1)?.id ?? 0;
  }

  private emit(b: Board, kind: string, taskId: string | null, payload: unknown = null, runId: number | null = null) {
    this.eventSeq += 1;
    b.events.push({ id: this.eventSeq, task_id: taskId, run_id: runId, kind, payload, created_at: now() });
    for (const l of this.listeners) l(b.slug);
  }

  private view(b: Board, t: Task) {
    const parents = b.links.filter((l) => l.child === t.id).map((l) => l.parent);
    const children = b.links.filter((l) => l.parent === t.id).map((l) => l.child);
    const done = children.filter((c) => b.tasks.find((x) => x.id === c)?.status === 'done').length;
    const worker = [...this.workers.values()].find((w) => w.task_id === t.id);
    return {
      ...t,
      current_run_id: worker?.run_id ?? null,
      comment_count: b.comments.filter((c) => c.task_id === t.id).length,
      link_counts: { parents: parents.length, children: children.length },
      progress: children.length ? { done, total: children.length } : null,
    };
  }

  private board(query: Record<string, string>): Board | Response {
    const slug = query.board || 'default';
    const b = this.boards.get(slug);
    if (!b || b.archived) return json({ detail: `board '${slug}' does not exist` }, 404);
    return b;
  }

  private startWorker(b: Board, t: Task) {
    this.runSeq += 1;
    const w: Worker = {
      run_id: this.runSeq, task_id: t.id, board: b.slug, task_title: t.title, task_assignee: t.assignee, profile: t.assignee,
      worker_pid: 40000 + this.runSeq, started_at: now(),
    };
    this.workers.set(w.run_id, w);
    t.status = 'running';
    t.started_at = now();
    if (t.workspace_kind === 'dir' && t.workspace_path && this.pathMap && t.workspace_path.startsWith(`${this.pathMap.from}/`)) {
      const local = `${this.pathMap.to}${t.workspace_path.slice(this.pathMap.from.length)}`;
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, 'resultat.md'), `# ${t.title}\n\nFichier écrit par le worker fake-hermes.\n`);
    }
    this.emit(b, 'spawned', t.id, { profile: t.assignee }, w.run_id);
    // /stuck/ in the title: the worker keeps running until terminated
    if (/stuck|bloque/i.test(t.title)) return;
    w.timer = setTimeout(() => {
      if (!this.workers.has(w.run_id)) return;
      this.workers.delete(w.run_id);
      t.status = 'done';
      t.completed_at = now();
      t.result = 'Terminé par fake-hermes.';
      this.emit(b, 'completed', t.id, null, w.run_id);
      this.recompute(b);
    }, this.stepMs);
  }

  /**
   * Like Hermes' `recompute_ready` (run after its writes and on each dispatcher tick): a `todo` task whose
   * parents are all done is promoted to `ready`. `todo` means "waiting for its parents", not "idle".
   */
  private recompute(b: Board) {
    for (const t of b.tasks) {
      if (t.status !== 'todo') continue;
      const parents = b.links.filter((l) => l.child === t.id).map((l) => b.tasks.find((x) => x.id === l.parent));
      if (parents.every((x) => !x || x.status === 'done')) {
        t.status = 'ready';
        this.emit(b, 'promoted', t.id);
      }
    }
  }

  /** null when the route is not a kanban route. */
  handle(via: 'api' | 'dash', method: string, path: string, query: Record<string, string>, body: unknown): Response | null {
    const res = this.route(via, method, path, query, body);
    if (res && method !== 'GET') for (const b of this.boards.values()) this.recompute(b);
    return res;
  }

  private route(via: 'api' | 'dash', method: string, path: string, query: Record<string, string>, body: unknown): Response | null {
    if (via !== 'dash' || !path.startsWith('/api/plugins/kanban/')) return null;
    const p = path.slice('/api/plugins/kanban'.length);
    const b0 = (body ?? {}) as Record<string, unknown>;

    if (method === 'GET' && p === '/workflow') return json(this.workflow);
    if (method === 'GET' && p === '/orchestration') return json(this.orchestration);
    if (method === 'PUT' && p === '/orchestration') {
      for (const k of ['orchestrator_profile', 'default_assignee', 'auto_decompose', 'auto_promote_children']) {
        if (b0[k] !== undefined && b0[k] !== null) this.orchestration[k] = b0[k];
      }
      return json(this.orchestration);
    }
    if (method === 'GET' && p === '/boards') {
      return json({
        boards: [...this.boards.values()].filter((b) => !b.archived || query.include_archived === 'true').map((b) => ({
          slug: b.slug, name: b.name, description: '', icon: '', color: '', default_workdir: null, project_id: null,
          created_at: b.created_at, archived: b.archived, is_current: b.slug === 'default', counts: {}, total: b.tasks.length,
          default_workspace_kind: 'scratch', project_name: null,
        })),
        current: 'default',
      });
    }
    if (method === 'POST' && p === '/boards') {
      const slug = String(b0.slug ?? '');
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) return json({ detail: `invalid board slug ${JSON.stringify(slug)}` }, 400);
      if (!this.boards.has(slug)) this.boards.set(slug, this.newBoard(slug, String(b0.name ?? slug), now()));
      const b = this.boards.get(slug)!;
      return json({ board: { slug: b.slug, name: b.name, archived: false, created_at: b.created_at }, current: 'default' });
    }
    if (method === 'GET' && p === '/assignees') {
      return json({ assignees: this.profiles().map((name) => ({ name, on_disk: true, counts: {} })) });
    }

    const b = this.board(query);
    if (b instanceof Response) return b;

    if (method === 'GET' && p === '/board') {
      const order = this.workflow.columns.map((c) => c.key);
      return json({
        columns: order.map((name) => ({ name, tasks: b.tasks.filter((t) => t.status === name).map((t) => this.view(b, t)) })),
        tenants: [], assignees: this.profiles(), latest_event_id: this.latestEvent(b.slug), now: now(),
      });
    }
    if (method === 'GET' && p === '/workers/active') {
      const workers = [...this.workers.values()].filter((w) => w.board === b.slug).map(({ timer: _t, board: _b, ...w }) => ({
        ...w, task_status: 'running', claim_lock: `lock-${w.run_id}`, claim_expires: null, last_heartbeat_at: null, max_runtime_seconds: null,
      }));
      return json({ workers, count: workers.length, checked_at: now() });
    }
    if (method === 'POST' && p === '/tasks') {
      const title = String(b0.title ?? '').trim();
      if (!title) return json({ detail: 'title is required' }, 400);
      this.taskSeq += 1;
      const t: Task = {
        id: `t_fake${String(this.taskSeq).padStart(4, '0')}`, title, body: typeof b0.body === 'string' ? b0.body : null,
        assignee: typeof b0.assignee === 'string' && b0.assignee ? b0.assignee : null,
        status: b0.triage ? 'triage' : 'ready', priority: typeof b0.priority === 'number' ? b0.priority : 0,
        created_by: 'dashboard', created_at: now(), started_at: null, completed_at: null,
        workspace_kind: typeof b0.workspace_kind === 'string' ? b0.workspace_kind : 'scratch',
        workspace_path: typeof b0.workspace_path === 'string' ? b0.workspace_path : null,
        result: null, last_failure_error: null, latest_summary: null,
      };
      b.tasks.push(t);
      for (const parent of Array.isArray(b0.parents) ? b0.parents.map(String) : []) b.links.push({ parent, child: t.id });
      // a ready task with an unfinished parent waits in todo
      if (t.status === 'ready' && b.links.some((l) => l.child === t.id && b.tasks.find((x) => x.id === l.parent)?.status !== 'done')) t.status = 'todo';
      this.emit(b, 'created', t.id, { status: t.status, assignee: t.assignee });
      return json({ task: this.view(b, t) });
    }
    if (method === 'POST' && p === '/dispatch') {
      const max = Number(query.max ?? 8);
      const ready = b.tasks.filter((t) => t.status === 'ready');
      const spawn = ready.filter((t) => t.assignee).slice(0, max);
      const out = {
        reclaimed: 0, promoted: 0, reconciled_orphans: [], reaped_terminal_workers: [],
        spawned: spawn.map((t) => [t.id, t.assignee, '']), skipped_unassigned: ready.filter((t) => !t.assignee).map((t) => t.id),
        auto_assigned_default: [], skipped_nonspawnable: [], skipped_per_profile_capped: [], crashed: [], auto_blocked: [],
        timed_out: [], stale: [], respawn_guarded: [], rate_limited: [], skipped_locked: false, memory_pressure: null,
      };
      if (query.dry_run !== 'true') for (const t of spawn) this.startWorker(b, t);
      return json(out);
    }
    if (p === '/links') {
      if (method === 'POST') {
        const parent = String(b0.parent_id ?? '');
        const child = String(b0.child_id ?? '');
        if (!b.tasks.some((t) => t.id === parent) || !b.tasks.some((t) => t.id === child)) return json({ detail: 'unknown task' }, 404);
        if (parent === child) return json({ detail: 'a task cannot depend on itself' }, 400);
        if (!b.links.some((l) => l.parent === parent && l.child === child)) b.links.push({ parent, child });
        // like Hermes' link_tasks: a ready child of an unfinished parent goes back to todo
        const c = b.tasks.find((t) => t.id === child)!;
        const gated = c.status === 'ready' && b.tasks.find((t) => t.id === parent)!.status !== 'done';
        if (gated) c.status = 'todo';
        this.emit(b, 'linked', child, { parent });
        return json({ ok: true, gated });
      }
      if (method === 'DELETE') {
        b.links = b.links.filter((l) => !(l.parent === query.parent_id && l.child === query.child_id));
        this.emit(b, 'unlinked', query.child_id ?? null, { parent: query.parent_id });
        return json({ ok: true });
      }
    }
    const att = /^\/attachments\/(\d+)$/.exec(p);
    if (att && method === 'GET') {
      const a = b.attachments.find((x) => x.id === Number(att[1]));
      if (!a) return json({ detail: 'attachment not found' }, 404);
      return new Response(new Uint8Array(a.data), { headers: { 'Content-Type': a.content_type, 'Content-Disposition': `attachment; filename="${a.filename}"` } });
    }
    let m = /^\/runs\/([^/]+)\/terminate$/.exec(p);
    if (m && method === 'POST') {
      const id = Number(m[1]);
      if (!Number.isInteger(id)) return json({ detail: [{ type: 'int_parsing', msg: 'Input should be a valid integer' }] }, 422);
      const w = this.workers.get(id);
      // Hermes 0.23.0: an unknown run is a 404, a run that already ended a 409
      if (!w && !b.events.some((e) => e.run_id === id)) return json({ detail: `run ${id} not found` }, 404);
      if (!w || w.board !== b.slug) return json({ detail: `cannot terminate run ${id}: task is no longer in a reclaimable state` }, 409);
      clearTimeout(w.timer);
      this.workers.delete(id);
      const t = b.tasks.find((x) => x.id === w.task_id);
      if (t) t.status = 'ready';
      this.emit(b, 'reclaimed', w.task_id, { manual: true, reason: b0.reason ?? null, retry_status: 'ready' }, id);
      return json({ ok: true, run_id: id, task_id: w.task_id });
    }
    m = /^\/tasks\/([^/]+)(\/[a-z]+)?$/.exec(p);
    if (!m) return null;
    const t = b.tasks.find((x) => x.id === m![1]);
    if (!t) return json({ detail: `task ${m[1]} not found` }, 404);
    const sub = m[2] ?? '';
    if (sub === '' && method === 'GET') {
      const parents = b.links.filter((l) => l.child === t.id).map((l) => l.parent);
      const children = b.links.filter((l) => l.parent === t.id).map((l) => l.child);
      return json({
        task: this.view(b, t),
        comments: b.comments.filter((c) => c.task_id === t.id),
        events: b.events.filter((e) => e.task_id === t.id),
        attachments: b.attachments.filter((a) => a.task_id === t.id).map(({ data, ...a }) => ({ ...a, size: data.length, uploaded_by: 'test', stored_path: `/opt/data/kanban/attachments/${a.filename}` })),
        links: { parents, children },
        link_tasks: [...parents, ...children].map((id) => b.tasks.find((x) => x.id === id)).filter(Boolean)
          .map((x) => ({ id: x!.id, title: x!.title, status: x!.status })),
        child_results: [], runs: [],
      });
    }
    if (sub === '' && method === 'PATCH') {
      if (typeof b0.status === 'string' && b0.status !== t.status) {
        const to = b0.status;
        if (to === 'running') return json({ detail: "Cannot set status to 'running' directly; use the dispatcher/claim path" }, 400);
        if (!(this.workflow.manual[t.status] ?? []).includes(to)) return json({ detail: `cannot move ${t.id} from '${t.status}' to '${to}'` }, 400);
        if (to === 'done') {
          const open = b.links.filter((l) => l.child === t.id).map((l) => b.tasks.find((x) => x.id === l.parent)).filter((x) => x && x.status !== 'done');
          if (open.length) {
            return json({ detail: `cannot move ${t.id} to 'done': unsatisfied parent dependencies: ${open.map((x) => `${x!.id} (${x!.status})`).join(', ')}` }, 400);
          }
        }
        t.status = to;
      }
      for (const k of ['assignee', 'priority', 'title', 'body', 'block_reason']) if (b0[k] !== undefined) t[k] = b0[k];
      this.emit(b, 'updated', t.id, b0);
      return json({ task: this.view(b, t) });
    }
    if (sub === '/comments' && method === 'POST') {
      b.comments.push({ id: b.comments.length + 1, task_id: t.id, author: String(b0.author ?? 'dashboard'), body: String(b0.body ?? ''), created_at: now() });
      this.emit(b, 'commented', t.id);
      return json({ ok: true });
    }
    if ((sub === '/specify' || sub === '/decompose') && method === 'POST') {
      if (!/preciser/i.test(t.title)) return json({ ok: false, task_id: t.id, reason: 'LLM error: AuxiliaryClientUnavailable', new_title: null });
      if (sub === '/specify') {
        t.body = `${t.body ?? ''}\n\nPrécisé par fake-hermes.`.trim();
        this.emit(b, 'specified', t.id);
        return json({ ok: true, task_id: t.id, reason: null, new_title: t.title });
      }
      this.emit(b, 'decomposed', t.id);
      return json({ ok: true, task_id: t.id, children: [] });
    }
    if (sub === '/log' && method === 'GET') {
      const ran = b.events.some((e) => e.task_id === t.id && e.kind === 'spawned');
      const content = ran ? Array.from({ length: 250 }, (_, i) => `ligne ${i + 1}`).concat('Authorization: Bearer sk-test-log-0123456789').join('\n') : '';
      return json({ task_id: t.id, path: `/opt/data/kanban/logs/${t.id}.log`, exists: ran, size_bytes: content.length, content, truncated: false });
    }
    return null;
  }
}
