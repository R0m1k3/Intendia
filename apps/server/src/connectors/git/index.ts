import { z } from 'zod';
import type { ModuleDef, OpDef } from '../types.js';
import { tolerantArray } from '../list.js';

export const GitRootSchema = z.looseObject({ root: z.string().nullable() });

export const GitStatusSchema = z.looseObject({
  branch: z.string().nullish(),
  defaultBranch: z.string().nullish(),
  detached: z.boolean().optional(),
  ahead: z.number().optional(),
  behind: z.number().optional(),
  staged: z.number().optional(),
  unstaged: z.number().optional(),
  untracked: z.number().optional(),
  conflicted: z.number().optional(),
  files: tolerantArray(z.looseObject({
    path: z.string(),
    staged: z.boolean().optional(),
    unstaged: z.boolean().optional(),
    untracked: z.boolean().optional(),
    conflicted: z.boolean().optional(),
  }), 'git.status_files').optional(),
}).nullable();
export type HermesGitStatus = NonNullable<z.infer<typeof GitStatusSchema>>;

export const GitListSchema = z.looseObject({
  // tolerant for the screen; GitService.list(r, true) refuses staging and commits when a row was dropped
  files: tolerantArray(z.looseObject({
    path: z.string(),
    added: z.number().optional(),
    removed: z.number().optional(),
    status: z.string().optional(),
    staged: z.boolean().optional(),
  }), 'git.list'),
});
export type HermesGitListFile = z.infer<typeof GitListSchema>['files'][number];

export const GitDiffSchema = z.looseObject({ diff: z.string() });
export const GitBranchesSchema = z.looseObject({
  branches: tolerantArray(z.looseObject({ name: z.string(), checkedOut: z.boolean().optional(), isRemote: z.boolean().optional() }), 'git.branches'),
});
export const GitContextSchema = z.looseObject({ diff: z.string(), recent: z.string().nullish() });

const read = (path: string, schema: z.ZodType, extra: Partial<OpDef> = {}): OpDef => ({
  kind: 'read', required: true, probe: false, schema, routes: [{ via: 'dash', method: 'GET', path }], ...extra,
});
const write = (path: string): OpDef => ({ kind: 'write', routes: [{ via: 'dash', method: 'POST', path }] });

/**
 * Git of the dashboard (`/api/fs/git-root`, `/api/git/*`). Hermes 0.23 does not confine their `path` to the managed
 * files root: only `GitService` (src/git/service.ts) calls them, with a path it built and checked inside a workspace.
 */
export const gitModule: ModuleDef = {
  id: 'git',
  label: 'Git',
  ops: {
    root: read('/api/fs/git-root', GitRootSchema),
    status: read('/api/git/status', GitStatusSchema),
    list: read('/api/git/review/list', GitListSchema),
    diff: read('/api/git/review/diff', GitDiffSchema),
    fileDiff: read('/api/git/file-diff', GitDiffSchema),
    branches: read('/api/git/branches', GitBranchesSchema, { required: false, optional: true }),
    context: read('/api/git/review/commit-context', GitContextSchema, { required: false, optional: true }),
    stage: write('/api/git/review/stage'),
    unstage: write('/api/git/review/unstage'),
    revert: write('/api/git/review/revert'),
    commit: write('/api/git/review/commit'),
    push: write('/api/git/review/push'),
    switch: write('/api/git/branch/switch'),
  },
};
