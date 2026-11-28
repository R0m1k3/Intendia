export interface FileEntry {
  name: string;
  /** Relative to the workspace. */
  path: string;
  kind: 'file' | 'dir' | 'link';
  target?: 'file' | 'dir';
  outside?: true;
  size: number;
  mtime: number;
  /** Instance root listing only: top-level folder that is a workspace of this instance (its slug). */
  workspace?: string;
}
export interface ShareLink {
  token: string;
  instanceId: string;
  path: string;
  agentPath: string;
  workspace: string | null;
  url: string;
  publicUntil: number | null;
  revoked: boolean;
  createdAt: number;
  exists: boolean;
}
/** A folder listing; `agentRoot` = the listed root as the agent sees it (absolute). */
export interface FileTree { path: string; entries: FileEntry[]; truncated: boolean; agentRoot?: string }
export interface GitFile {
  /** Relative to the repository; a folder not tracked yet ends with `/`. */
  path: string;
  /** M, A, D, R, C, U (conflict), ? (untracked). */
  status: string;
  staged: boolean;
  /** null: unknown (Hermes' status lists 200 files at most). */
  unstaged: boolean | null;
  conflicted: boolean;
  added: number;
  removed: number;
  dir: boolean;
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
export type GitDiffWhich = 'staged' | 'unstaged' | 'all';
