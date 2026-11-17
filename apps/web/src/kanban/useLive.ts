import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { kanbanPath } from '../api';

const DEBOUNCE_MS = 300;
const RETRY_MS = 60_000;
export const POLL_MS = 5_000;

export interface KanbanLiveDeps {
  EventSource: typeof EventSource;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
}

/**
 * Follows one board's stream. The server relays Hermes' kanban WebSocket as SSE `change {taskIds}`; `flush(touched)`
 * is called 300 ms after the last change. `ready` = the WebSocket to Hermes is subscribed: only then is the board
 * reread after a reopening (the SSE `open` only means the browser reached Intendia). When the stream closes,
 * `polling(true)` and the stream is tried again after 60 s. A renewal (`closed` with `code: "recycle"`, every 10 min)
 * reopens at once, without polling.
 */
export function followKanban(opts: {
  url: string;
  flush: (touched: Set<string>) => void;
  polling: (on: boolean) => void;
  deps?: Partial<KanbanLiveDeps>;
}): () => void {
  const d: KanbanLiveDeps = {
    EventSource: opts.deps?.EventSource ?? EventSource,
    setTimeout: opts.deps?.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimeout: opts.deps?.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
  };
  let es: EventSource | null = null;
  let retry: unknown;
  let debounce: unknown;
  let touched = new Set<string>();
  let stopped = false;
  // reopened after a failure or a renewal: changes may have been missed meanwhile
  let reread = false;

  const flush = () => {
    const t = touched;
    touched = new Set();
    opts.flush(t);
  };
  const open = () => {
    if (stopped) return;
    es = new d.EventSource(opts.url, { withCredentials: true });
    es.addEventListener('ready', () => {
      opts.polling(false);
      if (reread) {
        reread = false;
        flush();
      }
    });
    es.addEventListener('change', (ev) => {
      try {
        for (const id of (JSON.parse((ev as MessageEvent<string>).data) as { taskIds?: string[] }).taskIds ?? []) touched.add(id);
      } catch { /* ignore */ }
      d.clearTimeout(debounce);
      debounce = d.setTimeout(flush, DEBOUNCE_MS);
    });
    // closed by the server (WebSocket refused or cut) or network error: poll, retry later
    const fail = () => {
      es?.close();
      es = null;
      opts.polling(true);
      d.clearTimeout(retry);
      reread = true;
      retry = d.setTimeout(open, RETRY_MS);
    };
    es.addEventListener('closed', (ev) => {
      let code: unknown;
      try { code = (JSON.parse((ev as MessageEvent<string>).data) as { code?: unknown }).code; } catch { /* ignore */ }
      if (code !== 'recycle') return fail();
      // renewed by the server: reopen now, reread the board once Hermes is subscribed again
      es?.close();
      es = null;
      reread = true;
      open();
    });
    es.addEventListener('error', fail);
  };
  open();
  return () => {
    stopped = true;
    es?.close();
    d.clearTimeout(retry);
    d.clearTimeout(debounce);
  };
}

/** Live board (see followKanban): the board, and an open task it names, are reread on changes. */
export function useKanbanLive(inst: string, board: string | undefined, openTask: string | undefined): { polling: boolean } {
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  // the open task changes without reopening the stream
  const taskRef = useRef(openTask);
  taskRef.current = openTask;

  useEffect(() => {
    if (!board) return;
    return followKanban({
      url: `/x${kanbanPath(inst, 'events', board)}`,
      polling: setPolling,
      flush: (touched) => {
        void qc.invalidateQueries({ queryKey: ['kanban-board', inst, board] });
        const task = taskRef.current;
        if (task && touched.has(task)) void qc.invalidateQueries({ queryKey: ['kanban-task', inst, board, task] });
      },
    });
  }, [inst, board, qc]);

  return { polling };
}
