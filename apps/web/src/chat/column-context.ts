import { useNavigate } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useMemo } from 'react';

/**
 * A session shown in a column of the Chat page (chat/ChatPage.tsx). Absent elsewhere (side chat, external session):
 * the session page then behaves as a page of its own.
 */
export interface Column {
  /** session of the column */
  id: string;
  active: boolean;
  /** alone on screen: the thread keeps its centred reading width */
  wide: boolean;
  activate(): void;
  close(): void;
  /** the column `from` (this one by default) now shows another session; navigates when that column is gone */
  replace(slug: string, id: string, from?: string): void;
  report(r: { running: boolean; waiting: boolean; title: string }): void;
}

export const ColumnContext = createContext<Column | null>(null);

export function useColumn(): Column | null {
  return useContext(ColumnContext);
}

/**
 * Where the session page goes after an action: another session (agent change, copy, rewrite, undo, `/new`) or its
 * workspace (archived, deleted). In a column, the column changes (or closes); elsewhere, the page navigates.
 */
export function useOpenSession(): { open(slug: string, id: string, from?: string): void; leave(slug: string): void } {
  const col = useColumn();
  const navigate = useNavigate();
  const open = useCallback((slug: string, id: string, from?: string) => {
    if (col) col.replace(slug, id, from);
    else void navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: id } });
  }, [col, navigate]);
  const leave = useCallback((slug: string) => {
    if (col) col.close();
    else void navigate({ to: '/w/$slug', params: { slug } });
  }, [col, navigate]);
  return useMemo(() => ({ open, leave }), [open, leave]);
}
