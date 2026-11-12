// Edit, retry, branch, undo the last exchange, clear: Hermes 0.23 has no HTTP route that cuts a session, so each is
// a truncated copy (export, cut before a user message, import under a new id). "replace" puts the copy in the
// original's place (the original is deleted with the undo window); "branch" puts it next to it.
import type { CompatService } from '../compat/service.js';
import { HermesError, callOp } from '../connectors/runtime.js';
import { readRunStatus, whenIdle } from '../chat/history.js';
import { TERMINAL_STATUSES } from '../connectors/chat/index.js';
import { NotFoundError, UNDO_MS, type PublicSession, type SessionContext, type WorkspaceService } from '../workspaces/service.js';
import { copyId, copyPayload, CopyError, cutBefore, exportSession, importCopy } from './copy.js';

export type RewriteMode = 'replace' | 'branch';
export interface RewriteResult { session: PublicSession; replaced?: string; undoUntil?: number | null; created: boolean }

/** Wait for a stopped run to end: every 500 ms, 5 s at most. */
const STOP_POLL_MS = 500;
const STOP_WAIT_MS = 5_000;

export class RunActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunActiveError';
  }
}

export async function rewriteSession(
  deps: { workspaces: WorkspaceService; compat: CompatService },
  inst: string, id: string, o: { key: string; before: number | null; mode: RewriteMode },
): Promise<RewriteResult> {
  const { workspaces, compat } = deps;
  const row = workspaces.rowOf(inst, id);
  // the same key again (a retry after a lost answer): the first result, nothing asked to Hermes. The original's row
  // gives the workspace of the copy; once the purger dropped it, the copy is looked for in each workspace.
  const slugs = row ? [row.workspaceSlug] : workspaces.listWorkspaces().filter((w) => w.instanceId === inst).map((w) => w.slug);
  const done = slugs.map((slug) => workspaces.rowOf(inst, copyId(inst, slug, o.key))).find((r) => r !== null) ?? null;
  if (done && done.replacesId !== id && !row) throw new NotFoundError(`Session inconnue : ${id}`);
  if (done) {
    if (done.deletedAt !== null) throw new CopyError('reverted', 'Action déjà annulée', 409);
    const newId = done.sessionId;
    const original = done.replacesId ? workspaces.rowOf(inst, done.replacesId) : null;
    const undoUntil = original?.deletedAt ? original.deletedAt + UNDO_MS : null;
    return {
      session: workspaces.getSession(inst, newId).session, created: false,
      ...(done.replacesId ? { replaced: done.replacesId, undoUntil } : {}),
    };
  }
  if (!row) throw new NotFoundError(`Session inconnue : ${id}`);
  const newId = copyId(inst, row.workspaceSlug, o.key);
  // alive only: a tab left open on a replaced session does not make a second replacement
  const ctx = workspaces.getSession(inst, id);
  const s = ctx.session;
  const title = o.mode === 'branch' ? `${s.title || 'Nouvelle session'} (branche)` : s.title;
  let out: RewriteResult | null = null;
  const idle = await whenIdle(compat, ctx, async () => {
    // a session never sent has nothing at Hermes: the copy starts empty
    const atHermes = Boolean(s.lastRunId || s.copiedFrom) && o.before !== 0;
    let kept = 0;
    let cutTs: number | null = null;
    if (atHermes) {
      const exported = await exportSession(compat, inst, ctx.profile, id);
      const cut = cutBefore(exported, o.before);
      cutTs = cut.cutTs;
      kept = cut.exported.messages.length;
      if (kept) {
        try {
          await importCopy(compat, inst, ctx.profile, copyPayload(cut.exported, { id: newId, title: title || 'Nouvelle session' }));
        } catch (err) {
          // Hermes knows the id but has nothing under it: imported, undone and purged before
          if (err instanceof HermesError && err.detail.status === 409) throw new CopyError('reverted', 'Action déjà annulée', 409);
          throw err;
        }
      }
    }
    const keepRunsBefore = !kept ? null : o.before === null ? 'all' : cutTs === null ? null : cutTs * 1000;
    const res = await workspaces.replaceRows({
      slug: ctx.workspace.slug, instanceId: inst, newId, from: s, title, copiedFrom: kept ? id : null,
      replaces: o.mode === 'replace', keepRunsBefore,
    });
    out = { session: res.session, created: true, ...(o.mode === 'replace' ? { replaced: id, undoUntil: res.undoUntil } : {}) };
  });
  if (!idle) throw new RunActiveError('Une réponse est en cours : attendez la fin ou arrêtez-la');
  return out!;
}

/** "Annuler" of a replacement: the copy's run stopped if needed, the original back, the copy deleted. */
export async function revertRewrite(
  deps: { workspaces: WorkspaceService; compat: CompatService },
  inst: string, newId: string, now = Date.now(),
): Promise<PublicSession> {
  const { workspaces, compat } = deps;
  const tooLate = () => new CopyError('too_late', 'Trop tard : la session d’origine est supprimée', 409);
  const row = workspaces.rowOf(inst, newId);
  if (!row || row.deletedAt !== null || !row.replacesId) throw tooLate();
  const originalId = row.replacesId;
  if (!workspaces.holdWindow(inst, originalId, now)) throw tooLate();
  const ctx = workspaces.getSession(inst, newId);
  await stopLastRun(compat, ctx);
  let back = false;
  const idle = await whenIdle(compat, ctx, () => {
    back = workspaces.swapBack(inst, originalId, newId);
  });
  if (!idle) throw new RunActiveError('La réponse ne s’arrête pas : réessayez');
  if (!back) throw tooLate();
  return workspaces.getSession(inst, originalId).session;
}

async function stopLastRun(compat: CompatService, ctx: SessionContext): Promise<void> {
  const runId = ctx.session.lastRunId;
  if (!runId) return;
  const running = async () => {
    const st = await readRunStatus(compat, ctx.instance.id, ctx.profile, runId);
    return st.status !== 'unknown' && !TERMINAL_STATUSES.includes(st.status);
  };
  if (!(await running())) return;
  await callOp(compat.http(ctx.instance.id), compat.get(ctx.instance.id), 'chat', 'stopRun', { params: { run_id: runId }, profile: ctx.profile, body: {} })
    .catch(() => {});
  for (let waited = 0; waited < STOP_WAIT_MS; waited += STOP_POLL_MS) {
    await new Promise((r) => setTimeout(r, STOP_POLL_MS));
    if (!(await running())) return;
  }
  throw new RunActiveError('La réponse ne s’arrête pas : réessayez');
}

