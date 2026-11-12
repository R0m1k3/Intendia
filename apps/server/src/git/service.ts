/**
 * Git of the workspaces, through the dashboard routes of their Hermes (`/api/fs/git-root`, `/api/git/*`).
 *
 * Hermes 0.23 runs git in any folder of its host given as `path`: this is the only code that calls those routes,
 * always with a path it built from the workspace folder and checked. The browser gives a workspace slug, a repository
 * folder relative to the workspace and file paths relative to the repository, never an absolute path.
 */
import type { CompatService } from '../compat/service.js';
import { GitBranchesSchema, type HermesGitListFile, type HermesGitStatus } from '../connectors/git/index.js';
import type { CompatReport } from '../connectors/types.js';
import { callOp, HermesError, hermesDetail, type HermesHttp } from '../connectors/runtime.js';
import type { FileRoots } from '../files/hermes-fs.js';
import { hiddenByHermes, normalizeRel } from '../files/paths.js';
import type { InstanceConfig } from '../config.js';
import { WorkspaceFsError } from '../workspaces/fs.js';
import type { WorkspaceService } from '../workspaces/service.js';

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
}
