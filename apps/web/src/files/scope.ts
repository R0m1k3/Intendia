import { api, instanceRawUrl, instanceZipUrl, rawUrl, zipUrl, type FileTree } from '../api';

/**
 * Where FileRows and Preview read their files: a workspace (actions, edit, share) or the whole file root of an
 * instance (read only). `key` prefixes the TanStack queries: `['tree', slug]` stays the key every existing
 * invalidation uses.
 */
export interface FileScope {
  key: readonly string[];
  tree: (path: string) => Promise<FileTree>;
  raw: (path: string, download?: boolean) => string;
  /** URL of a folder as a zip. */
  zip: (path: string) => string;
  /** Set for a workspace: writes allowed. */
  workspace?: string;
}

export const workspaceScope = (slug: string): FileScope => ({
  key: ['tree', slug],
  tree: (path) => api.tree(slug, path),
  raw: (path, download) => rawUrl(slug, path, download),
  zip: (path) => zipUrl(slug, path),
  workspace: slug,
});

export const instanceScope = (inst: string): FileScope => ({
  key: ['instance-tree', inst],
  tree: (path) => api.instanceTree(inst, path),
  raw: (path, download) => instanceRawUrl(inst, path, download),
  zip: (path) => instanceZipUrl(inst, path),
});
