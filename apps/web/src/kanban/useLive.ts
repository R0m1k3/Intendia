import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { kanbanPath } from '../api';

const DEBOUNCE_MS = 300;
const RETRY_MS = 60_000;
export const POLL_MS = 5_000;

/**
 * Live board: the server relays Hermes' kanban WebSocket as SSE `change {taskIds}`; the board (and an
 * open task it names) is reread 300 ms after the last change. When the stream closes, `polling` is true
 * (the page rereads every 5 s) and the stream is tried again after 60 s.
 */
export function useKanbanLive(inst: string, board: string | undefined, openTask: string | undefined): { polling: boolean } {
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  // the open task changes without reopening the stream
  const taskRef = useRef(openTask);
  taskRef.current = openTask;

  useEffect(() => {
    if (!board) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let touched = new Set<string>();
    let stopped = false;

    const flush = () => {
      void qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] });
      const task = taskRef.current;
      if (task && touched.has(task)) void qc.invalidateQueries({ queryKey: ['kanban-task', inst, board, task] });
      touched = new Set();
    };
    const open = () => {
      if (stopped) return;
      es = new EventSource(`/x${kanbanPath(inst, 'events', board)}`, { withCredentials: true });
      es.addEventListener('open', () => setPolling(false));
      es.addEventListener('change', (ev) => {
        try {
          for (const id of (JSON.parse((ev as MessageEvent<string>).data) as { taskIds?: string[] }).taskIds ?? []) touched.add(id);
        } catch { /* ignore */ }
        clearTimeout(debounce);
        debounce = setTimeout(flush, DEBOUNCE_MS);
      });
      // closed by the server (WebSocket refused or cut) or network error: poll, retry later
      const fail = () => {
        es?.close();
        es = null;
        setPolling(true);
        clearTimeout(retry);
        retry = setTimeout(open, RETRY_MS);
      };
      es.addEventListener('closed', fail);
      es.addEventListener('error', fail);
    };
    open();
    return () => {
      stopped = true;
      es?.close();
      clearTimeout(retry);
      clearTimeout(debounce);
    };
  }, [inst, board, qc]);

  return { polling };
}
