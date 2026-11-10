import { createContext, useContext } from 'react';
import type { MountInfo } from './paths';

/** What the thread needs to turn file paths into chips (provided by the session page). */
export interface FilePathsValue {
  /** Path as written in the chat → path relative to the workspace (only paths that exist). */
  found: Map<string, string>;
  open: (path: string) => void;
  slug: string;
  /** The workspace as the agent and Intendia see it; null until the instances are loaded. */
  mounts: MountInfo | null;
}

export const FilePaths = createContext<FilePathsValue | null>(null);

export function useFilePaths(): FilePathsValue | null {
  return useContext(FilePaths);
}
