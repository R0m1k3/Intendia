/**
 * Git of the workspaces, through the dashboard routes of their Hermes (`/api/fs/git-root`, `/api/git/*`).
 *
 * Hermes 0.23 runs git in any folder of its host given as `path`: this is the only code that calls those routes,
 * always with a path it built from the workspace folder and checked. The browser gives a workspace slug, a repository
 * folder relative to the workspace and file paths relative to the repository, never an absolute path.
 */
import type { CompatService } from '../compat/service.js';
import { GitBranchesSchema, GitContextSchema, type HermesGitListFile, type HermesGitStatus } from '../connectors/git/index.js';
import type { CompatReport } from '../connectors/types.js';
import { callOp, HermesError, hermesDetail, type HermesHttp } from '../connectors/runtime.js';
import type { FileRoots } from '../files/hermes-fs.js';
import { hiddenByHermes, normalizeRel } from '../files/paths.js';
import type { InstanceConfig } from '../config.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import { ValidationError, type WorkspaceService } from '../workspaces/service.js';
import { GatewaySocketError, oneshot } from '../hermes/gateway-ws.js';

export type GitErrorCode = 'sensitive' | 'staged_sensitive' | 'nothing_staged' | 'git_failed' | 'busy' | 'unsupported' | 'no_model' | 'empty';
const GIT_STATUS: Record<GitErrorCode, 403 | 409 | 502 | 503> = {
  sensitive: 403, staged_sensitive: 409, nothing_staged: 409, git_failed: 409, busy: 409, unsupported: 409, empty: 502, no_model: 503,
};

export class GitError extends Error {
  readonly status: 403 | 409 | 502 | 503;
  constructor(readonly code: GitErrorCode, message: string) {
    super(message);
    this.name = 'GitError';
    this.status = GIT_STATUS[code];
  }
}

/** Files sent to the browser at most (the server works on the whole list). */
export const GIT_LIST_MAX = 1000;
const TIMEOUT_MS = 45_000;
const LONG_MS = 60_000;
export const MESSAGE_MAX = 5000;
const DETAIL_MAX = 2000;

export interface GitFile {
  /** Relative to the repository; a folder not tracked yet ends with `/`. */
  path: string;
  /** Hermes' letter: M, A, D, R, C, U (conflict), ? (untracked). */
  status: string;
  staged: boolean;
  /** Has changes not staged; null when unknown (Hermes' status lists 200 files at most). */
  unstaged: boolean | null;
  conflicted: boolean;
  added: number;
  removed: number;
  dir: boolean;
  /** A credential file Hermes hides: no diff, never staged nor reverted by Intendia. */
  sensitive: boolean;
}

export interface GitStatus {
  repo: string;
  branch: string | null;
  defaultBranch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number };
  files: GitFile[];
  truncated: boolean;
}

export type DiffWhich = 'staged' | 'unstaged' | 'all';

/**
 * A file path given by the browser, relative to the repository. Hermes passes it to `git add`, `reset`, `checkout`
 * and `clean` as a pathspec: wildcards and magic (`:(…)`) are refused. A final `/` (folder not tracked) is kept.
 */
export function checkFile(file: string): { path: string; dir: boolean } {
  if (typeof file !== 'string') throw new WorkspaceFsError('invalid', 'Fichier invalide');
  const dir = file.endsWith('/');
  const rel = normalizeRel(file);
  if (rel.startsWith(':') || /[*?[\]]/.test(rel)) {
    throw new WorkspaceFsError('invalid', `${rel.slice(0, 200)} : Intendia ne gère pas ce nom (caractère * ? [ ] ou : au début), demandez-le à l'agent`);
  }
  return { path: dir ? `${rel}/` : rel, dir };
}

interface Place { inst: InstanceConfig; http: HermesHttp; report: CompatReport | undefined; root: string; wsAbs: string; slug: string }
export interface Repo extends Place { repo: string; abs: string }

const under = (parent: string, rel: string) => (rel ? `${parent}/${rel}` : parent);

export class GitService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly roots: FileRoots,
    private readonly compat: CompatService,
  ) {}

  private place(slug: string): Place {
    const ws = this.workspaces.getWorkspace(slug);
    const root = this.roots.root(ws.instanceId);
    return {
      inst: this.workspaces.instanceOf(ws), http: this.compat.http(ws.instanceId), report: this.compat.get(ws.instanceId),
      root, wsAbs: `${root}/${slug}`, slug,
    };
  }

  /** Calls an op of the git module with `path` = the checked absolute folder. */
  private async call<T>(p: Pick<Place, 'http' | 'report'> & { abs: string }, op: string, opts: { query?: Record<string, string>; body?: Record<string, unknown>; timeoutMs?: number } = {}): Promise<T> {
    const isRead = !opts.body;
    try {
      return await callOp<T>(p.http, p.report, 'git', op, {
        ...(isRead ? { query: { ...opts.query, path: p.abs } } : { body: { ...opts.body, path: p.abs } }),
        timeoutMs: opts.timeoutMs ?? TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof HermesError && err.kind === 'http') {
        const detail = hermesDetail(err).slice(0, DETAIL_MAX);
        if (err.detail.status === 400) throw new GitError('git_failed', detail || 'git a échoué');
        if (err.detail.status === 403) throw new GitError('sensitive', `Refusé par Hermes : ${detail}`);
      }
      throw err;
    }
  }

  private async gitRoot(p: Place, abs: string): Promise<string | null> {
    return (await this.call<{ root: string | null }>({ ...p, abs }, 'root')).root;
  }

  /** The repository holding `dir` (relative to the workspace), when it starts in the workspace. */
  async locate(slug: string, dir: string): Promise<{ repo: string | null; outside: boolean }> {
    const p = this.place(slug);
    const root = await this.gitRoot(p, under(p.wsAbs, normalizeRel(dir, { allowRoot: true })));
    if (root === null) return { repo: null, outside: false };
    if (root === p.wsAbs) return { repo: '', outside: false };
    if (root.startsWith(`${p.wsAbs}/`)) return { repo: root.slice(p.wsAbs.length + 1), outside: false };
    return { repo: null, outside: true };
  }

  /**
   * Checks once per request that `repo` is the root of a repository inside the workspace: Hermes resolves the
   * path (links followed) and must answer this very folder, whose `.git` must be a real folder (a `.git` file, as
   * in submodules and linked worktrees, points to a repository that can be anywhere on the host).
   */
  async open(slug: string, repo: string): Promise<Repo> {
    const p = this.place(slug);
    const rel = normalizeRel(repo, { allowRoot: true });
    const abs = under(p.wsAbs, rel);
    if (await this.gitRoot(p, abs) !== abs) {
      throw new WorkspaceFsError('outside', `${rel || slug} : ce dossier n'est pas la racine d'un dépôt git du workspace`);
    }
    const dotGit = await this.roots.fs(this.workspaces.getWorkspace(slug).instanceId).entry(under(slug, rel ? `${rel}/.git` : '.git'));
    if (!dotGit || !dotGit.isDir || dotGit.isLink) {
      throw new WorkspaceFsError('outside', `${rel || slug} : dépôt refusé, son .git est un lien ou un fichier (sous-module, worktree lié)`);
    }
    return { ...p, repo: rel, abs };
  }

  /** The whole list of changed files (not cut), each with what Intendia needs. */
  async files(r: Repo, status?: HermesGitStatus | null): Promise<GitFile[]> {
    const [list, st] = await Promise.all([
      this.call<{ files: HermesGitListFile[] }>(r, 'list', { query: { scope: 'uncommitted' } }),
      status === undefined ? this.call<HermesGitStatus | null>(r, 'status') : Promise.resolve(status),
    ]);
    const known = new Map((st?.files ?? []).map((f) => [f.path, f]));
    return list.files.map((f) => {
      const s = known.get(f.path);
      const letter = f.status ?? 'M';
      return {
        path: f.path,
        status: letter,
        staged: Boolean(f.staged),
        unstaged: s ? Boolean(s.unstaged || s.untracked) : null,
        conflicted: s ? Boolean(s.conflicted) : letter === 'U',
        added: f.added ?? 0,
        removed: f.removed ?? 0,
        dir: f.path.endsWith('/'),
        sensitive: hiddenByHermes(normalizeRel(under(r.repo, f.path))),
      };
    });
  }

  async status(slug: string, repo: string): Promise<GitStatus> {
    const r = await this.open(slug, repo);
    const st = await this.call<HermesGitStatus | null>(r, 'status');
    if (!st) throw new WorkspaceFsError('not_found', 'Ce dossier n\'est plus un dépôt git');
    const files = await this.files(r, st);
    return {
      repo: r.repo,
      branch: st.branch ?? null,
      defaultBranch: st.defaultBranch ?? null,
      detached: Boolean(st.detached),
      ahead: st.ahead ?? 0,
      behind: st.behind ?? 0,
      counts: { staged: st.staged ?? 0, unstaged: st.unstaged ?? 0, untracked: st.untracked ?? 0, conflicted: st.conflicted ?? 0 },
      files: files.slice(0, GIT_LIST_MAX),
      truncated: files.length > GIT_LIST_MAX,
    };
  }

  async diff(slug: string, repo: string, file: string, which: DiffWhich): Promise<string> {
    const f = checkFile(file);
    if (f.dir) throw new WorkspaceFsError('invalid', 'Pas de diff pour un dossier non suivi');
    if (hiddenByHermes(normalizeRel(under(normalizeRel(repo, { allowRoot: true }), f.path)))) {
      throw new GitError('sensitive', `${f.path} : fichier sensible, diff non affiché`);
    }
    const r = await this.open(slug, repo);
    const res = which === 'all'
      ? await this.call<{ diff: string }>(r, 'fileDiff', { query: { file: f.path } })
      : await this.call<{ diff: string }>(r, 'diff', { query: { file: f.path, scope: 'uncommitted', staged: which === 'staged' ? 'true' : 'false' } });
    return res.diff;
  }

  /** Local branches, the current one first. */
  async branches(slug: string, repo: string): Promise<{ branches: { name: string; current: boolean }[] }> {
    const r = await this.open(slug, repo);
    const res = GitBranchesSchema.parse(await this.call(r, 'branches'));
    const local = res.branches.filter((b) => !b.isRemote).map((b) => ({ name: b.name, current: Boolean(b.checkedOut) }));
    local.sort((a, b) => (a.current === b.current ? a.name.localeCompare(b.name) : a.current ? -1 : 1));
    return { branches: local };
  }

  // ---- writes: one at a time per repository ----

  private readonly busy = new Set<string>();

  private async locked<T>(slug: string, repo: string, fn: (r: Repo) => Promise<T>): Promise<T> {
    const r = await this.open(slug, repo);
    const key = `${r.inst.id}:${r.abs}`;
    if (this.busy.has(key)) throw new GitError('busy', 'Une action git est déjà en cours sur ce dépôt');
    this.busy.add(key);
    try {
      return await fn(r);
    } finally {
      this.busy.delete(key);
    }
  }

  private async list(r: Repo): Promise<HermesGitListFile[]> {
    return (await this.call<{ files: HermesGitListFile[] }>(r, 'list', { query: { scope: 'uncommitted' } })).files;
  }

  private sensitive(r: Repo, path: string): boolean {
    return hiddenByHermes(normalizeRel(under(r.repo, path)));
  }

  /**
   * Stages a file, a folder line, or everything (`file` null: `add -A`). A folder not tracked yet can hold a
   * credential file that neither git's list nor Hermes' file list shows: after staging, every credential file
   * this action staged is unstaged again and named in the answer.
   */
  async stage(slug: string, repo: string, file: string | null): Promise<{ unstaged: string[] }> {
    const f = file === null ? null : checkFile(file);
    return this.locked(slug, repo, async (r) => {
      if (f && !f.dir && this.sensitive(r, f.path)) throw new GitError('sensitive', `${f.path} : fichier sensible, Intendia ne l'indexe pas`);
      const before = new Set((await this.list(r)).filter((x) => x.staged && this.sensitive(r, x.path)).map((x) => x.path));
      await this.call(r, 'stage', { body: f ? { file: f.path } : {} });
      const added = (await this.list(r)).filter((x) => x.staged && this.sensitive(r, x.path) && !before.has(x.path)).map((x) => x.path);
      for (const path of added) await this.call(r, 'unstage', { body: { file: path } });
      return { unstaged: added };
    });
  }

  async unstage(slug: string, repo: string, file: string | null): Promise<{ ok: true }> {
    const f = file === null ? null : checkFile(file);
    return this.locked(slug, repo, async (r) => {
      await this.call(r, 'unstage', { body: f ? { file: f.path } : {} });
      return { ok: true as const };
    });
  }

  /**
   * Discards the changes of one listed file (an untracked one is deleted). Never a folder: `git clean -fd` would also
   * delete the credential files Hermes hides. Hermes answers ok even when nothing happened: the list is read again.
   */
  async revert(slug: string, repo: string, file: string): Promise<{ ok: true }> {
    const f = checkFile(file);
    return this.locked(slug, repo, async (r) => {
      if (this.sensitive(r, f.path)) throw new GitError('sensitive', `${f.path} : fichier sensible, Intendia ne l'annule pas`);
      const row = (await this.list(r)).find((x) => x.path === f.path);
      if (!row || row.path.endsWith('/') || row.status === 'R' || row.status === 'C') {
        throw new ValidationError('Seul un fichier listé (ni dossier, ni renommage) peut être annulé ; supprimez un dossier depuis la page Fichiers');
      }
      if (row.status === 'A') await this.call(r, 'unstage', { body: { file: f.path } });
      await this.call(r, 'revert', { body: { file: f.path } });
      if ((await this.list(r)).some((x) => x.path === f.path)) throw new GitError('git_failed', `Annulation non faite : ${f.path} est toujours modifié`);
      return { ok: true as const };
    });
  }

  /**
   * Commits what is staged. Never when nothing is staged (Hermes would then stage everything, credential files
   * included) nor while a credential file is staged. The push is a separate call: a failed push keeps the commit.
   */
  async commit(slug: string, repo: string, message: string, push: boolean): Promise<{ committed: true; pushError?: string }> {
    const text = message.trim();
    if (!text || text.length > MESSAGE_MAX) throw new ValidationError(`Message de commit vide ou trop long (${MESSAGE_MAX} caractères au plus)`);
    return this.locked(slug, repo, async (r) => {
      const staged = (await this.list(r)).filter((x) => x.staged);
      if (!staged.length) throw new GitError('nothing_staged', 'Rien n\'est indexé : indexez d\'abord les fichiers à valider');
      const bad = staged.filter((x) => this.sensitive(r, x.path)).map((x) => x.path);
      if (bad.length) throw new GitError('staged_sensitive', `Fichiers sensibles indexés : ${bad.join(', ')} ; désindexez-les avant de valider`);
      await this.call(r, 'commit', { body: { message: text, push: false } });
      if (!push) return { committed: true as const };
      try {
        await this.pushRepo(r);
        return { committed: true as const };
      } catch (err) {
        return { committed: true as const, pushError: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  private async pushRepo(r: Repo): Promise<void> {
    const st = await this.call<HermesGitStatus | null>(r, 'status');
    if (st?.detached) throw new ValidationError('HEAD détaché : rien à pousser');
    await this.call(r, 'push', { body: {}, timeoutMs: LONG_MS });
  }

  async push(slug: string, repo: string): Promise<{ ok: true }> {
    return this.locked(slug, repo, async (r) => {
      await this.pushRepo(r);
      return { ok: true as const };
    });
  }

  async switchBranch(slug: string, repo: string, branch: string): Promise<{ branch: string }> {
    return this.locked(slug, repo, async (r) => {
      const res = GitBranchesSchema.parse(await this.call(r, 'branches'));
      if (!res.branches.some((b) => !b.isRemote && b.name === branch)) throw new ValidationError(`Branche inconnue : ${branch.slice(0, 200)}`);
      await this.call(r, 'switch', { body: { branch } });
      return { branch };
    });
  }

  /** A commit message for what is staged, by the auxiliary model of Hermes (`llm.oneshot`, template `commit_message`). */
  async message(slug: string, repo: string, avoid?: string): Promise<{ message: string }> {
    return this.locked(slug, repo, async (r) => {
      if (!r.report?.socket?.oneshot) throw new GitError('unsupported', 'Message par l\'IA indisponible sur cette instance');
      if (!(await this.list(r)).some((x) => x.staged)) throw new GitError('nothing_staged', 'Rien n\'est indexé : indexez d\'abord les fichiers à valider');
      const ctx = GitContextSchema.parse(await this.call(r, 'context'));
      let text: string;
      try {
        text = await oneshot(r.inst, {
          template: 'commit_message',
          variables: { diff: ctx.diff, recent_commits: ctx.recent ?? '', ...(avoid ? { avoid } : {}) },
          task: 'title_generation', max_tokens: 400,
        }, { factory: this.compat.wsFactory, timeoutMs: TIMEOUT_MS });
      } catch (err) {
        if (err instanceof GatewaySocketError && err.code === 5030) throw new GitError('no_model', 'Aucun modèle n\'est configuré pour les messages sur cette instance');
        if (err instanceof GatewaySocketError && err.code === 4031) throw new GitError('unsupported', 'Modèle de message absent de cette version d\'Hermes');
        if (err instanceof GatewaySocketError) throw new GitError('empty', `Message non obtenu : ${err.message}`);
        throw err;
      }
      const message = cleanMessage(text);
      if (!message) throw new GitError('empty', 'Le modèle n\'a pas proposé de message');
      return { message };
    });
  }
}

/** The model's text as a commit message: trimmed, without wrapping quotes or code fence, MESSAGE_MAX at most. */
export function cleanMessage(text: string): string {
  let t = text.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1]!.trim();
  if (/^(["'«“]).*(["'»”])$/s.test(t)) t = t.slice(1, -1).trim();
  return t.slice(0, MESSAGE_MAX);
}
