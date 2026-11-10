import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { CompatService } from '../compat/service.js';
import { openKanbanEvents, type WsFactory } from '../connectors/kanban/index.js';
import { disposition, FILE_CSP } from '../files/send.js';
import type { ConfigService } from '../hermes-config/service.js';
import { KanbanError, LIMITS, START_STATES, type KanbanService } from '../kanban/service.js';
import { ValidationError } from '../workspaces/service.js';
import { BOARD_RE, intParam, PROFILE_RE, TASK_RE } from './params.js';

/** `?board=` (required): Intendia never relies on Hermes' global "current board". */
export function boardOf(c: Context): string {
  const board = c.req.query('board') ?? '';
  if (!BOARD_RE.test(board)) throw new ValidationError('tableau invalide');
  return board;
}

function taskOf(c: Context): string {
  const id = c.req.param('id') ?? '';
  if (!TASK_RE.test(id)) throw new ValidationError('tâche invalide');
  return id;
}

const task = z.string().regex(TASK_RE);
const profile = z.string().regex(PROFILE_RE);
const CreateBoard = z.object({ slug: z.string().regex(BOARD_RE), name: z.string().max(LIMITS.boardName).optional() });
const CreateTask = z.object({
  title: z.string().min(1).max(LIMITS.title),
  body: z.string().max(LIMITS.body).optional(),
  assignee: profile.nullish(),
  priority: z.number().int().min(-1000).max(1000).nullish(),
  start: z.enum(START_STATES).optional(),
  workspace: z.string().max(64).nullish(),
});
// unknown fields (metadata, workspace_path…) are dropped by zod
const UpdateTask = z.object({
  status: z.string().regex(/^[a-z_]{1,32}$/).optional(),
  assignee: profile.nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).nullable().optional(),
  title: z.string().max(LIMITS.title).optional(),
  body: z.string().max(LIMITS.body).optional(),
  blockReason: z.string().max(LIMITS.blockReason).optional(),
});
const Comment = z.object({ body: z.string().min(1).max(LIMITS.comment) });
const Link = z.object({ parent: task, child: task });
// Hermes writes "" for "none"
const noneOrProfile = z.union([z.literal(''), profile]).nullable().optional().transform((v) => (v === null ? '' : v));
const Orchestration = z.object({
  orchestrator_profile: noneOrProfile,
  default_assignee: noneOrProfile,
  auto_decompose: z.boolean().optional(),
  auto_promote_children: z.boolean().optional(),
});

const PING_MS = 25_000;

export function kanbanRoutes(deps: { kanban: KanbanService; config: ConfigService; compat: CompatService; wsFactory?: WsFactory; wsOpenTimeoutMs?: number }): Hono {
  const { kanban } = deps;
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  const P = '/i/:inst/kanban';

  r.get(`${P}/boards`, async (c) => c.json({ boards: await kanban.boards(inst(c)) }));
  r.post(`${P}/boards`, async (c) => c.json({ board: await kanban.createBoard(inst(c), CreateBoard.parse(await c.req.json())) }, 201));
  r.get(`${P}/board`, async (c) => c.json(await kanban.board(inst(c), boardOf(c))));
  r.get(`${P}/workflow`, async (c) => c.json(await kanban.workflow(inst(c))));
  r.get(`${P}/assignees`, async (c) => c.json({ assignees: await kanban.assignees(inst(c)) }));
  r.get(`${P}/orchestration`, async (c) => c.json(await kanban.orchestration(inst(c))));
  r.put(`${P}/orchestration`, async (c) => {
    const body = Orchestration.parse(await c.req.json());
    return c.json(await deps.config.setOrchestration(inst(c), body));
  });

  r.post(`${P}/tasks`, async (c) => {
    const board = boardOf(c);
    return c.json({ task: await kanban.createTask(inst(c), board, CreateTask.parse(await c.req.json())) }, 201);
  });
  r.get(`${P}/tasks/:id`, async (c) => c.json(await kanban.task(inst(c), boardOf(c), taskOf(c))));
  r.patch(`${P}/tasks/:id`, async (c) => {
    const board = boardOf(c);
    const id = taskOf(c);
    return c.json({ task: await kanban.updateTask(inst(c), board, id, UpdateTask.parse(await c.req.json())) });
  });
  r.get(`${P}/tasks/:id/log`, async (c) => c.json(await kanban.log(inst(c), boardOf(c), taskOf(c))));
  r.post(`${P}/tasks/:id/comments`, async (c) => {
    const board = boardOf(c);
    const id = taskOf(c);
    return c.json(await kanban.comment(inst(c), board, id, Comment.parse(await c.req.json()).body));
  });
  r.post(`${P}/tasks/:id/specify`, async (c) => c.json(await kanban.aux(inst(c), boardOf(c), taskOf(c), 'specify')));
  r.post(`${P}/tasks/:id/decompose`, async (c) => c.json(await kanban.aux(inst(c), boardOf(c), taskOf(c), 'decompose')));
  r.post(`${P}/links`, async (c) => {
    const board = boardOf(c);
    const l = Link.parse(await c.req.json());
    return c.json(await kanban.link(inst(c), board, l.parent, l.child));
  });
  r.delete(`${P}/links`, async (c) => {
    const board = boardOf(c);
    const l = Link.parse({ parent: c.req.query('parent'), child: c.req.query('child') });
    return c.json(await kanban.unlink(inst(c), board, l.parent, l.child));
  });
  r.post(`${P}/dispatch`, async (c) => c.json(await kanban.dispatch(inst(c), boardOf(c), c.req.query('dry_run') === '1')));
  r.post(`${P}/workers/:runId/stop`, async (c) =>
    c.json(await kanban.stopWorker(inst(c), boardOf(c), intParam(c.req.param('runId'), 'run'))));

  r.get(`${P}/attachments/:aid`, async (c) => {
    const board = boardOf(c);
    const aid = intParam(c.req.param('aid'), 'pièce jointe');
    const res = await kanban.attachment(inst(c), board, aid);
    const fromHermes = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1];
    let name = `piece-${aid}`;
    try {
      if (fromHermes) name = decodeURIComponent(fromHermes).replace(/[/\\\0]/g, '_').slice(0, 200) || name;
    } catch { /* malformed: keep the default */ }
    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Disposition': disposition('attachment', name),
        'Content-Security-Policy': FILE_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  });

  /**
   * Live changes of a board: one dashboard WebSocket per open stream, relayed as SSE `change {taskIds}`.
   * When the WebSocket fails or closes, the stream is closed (the browser falls back to polling).
   */
  r.get(`${P}/events`, (c) => {
    const id = inst(c);
    const board = boardOf(c);
    if (!kanban.can(id, 'board')) throw new KanbanError('hermes_conflict', 'Kanban indisponible sur cette instance');
    const instance = deps.compat.http(id).instance;
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        let done = false;
        const send = (text: string) => { if (!done) ctrl.enqueue(enc.encode(text)); };
        const finish = () => {
          if (done) return;
          done = true;
          clearInterval(ping);
          conn.close();
          try { ctrl.close(); } catch { /* already closed */ }
        };
        const ping = setInterval(() => send(': ping\n\n'), PING_MS);
        const conn = openKanbanEvents(instance, board, {
          onOpen: () => send(': open\n\n'),
          onEvents: (events) => {
            const taskIds = [...new Set(events.map((e) => e.task_id).filter((t): t is string => typeof t === 'string'))];
            send(`event: change\ndata: ${JSON.stringify({ taskIds })}\n\n`);
          },
          onClose: (reason) => {
            send(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
            finish();
          },
        }, deps.wsFactory, deps.wsOpenTimeoutMs);
        cleanup = finish;
        c.req.raw.signal.addEventListener('abort', finish);
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  });

  return r;
}
