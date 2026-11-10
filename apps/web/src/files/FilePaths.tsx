import { createContext, useContext } from 'react';

/** What the thread needs to turn file paths into chips (provided by the session page). */
export interface FilePathsValue {
  /** Path as written in the chat → path relative to the workspace (only paths that exist). */
  found: Map<string, string>;
  open: (path: string) => void;
}

export const FilePaths = createContext<FilePathsValue | null>(null);

export function useFilePaths(): FilePathsValue | null {
  return useContext(FilePaths);
}
