import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api';
import { Button } from '../components/ui';

/**
 * "Session supprimée · Annuler" banner. The server keeps a deleted session for its undo window (`undoUntil`);
 * `showUndo()` (from any page) shows the banner, the <UndoHost/> mounted once at the root draws it.
 */
/** `run`: what "Annuler" does (default: restore the deleted `ids`). */
export interface Undo { inst: string; ids: string[]; undoUntil: number; label: string; run?: () => Promise<unknown> }

let push: ((u: Undo) => void) | null = null;

export function showUndo(u: Undo): void {
  push?.(u);
}

/** Query keys of the session lists, refreshed after a deletion or a restore. */
export const SESSION_LIST_KEYS = [['sessions'], ['sessions-recent'], ['sessions-list'], ['sessions-search'], ['sessions-cleanup'], ['workspaces']] as const;

/** Every list that shows sessions (workspace lists, the inbox column, its search, the sidebar counters). */
export function invalidateSessionLists(qc: QueryClient): Promise<unknown> {
  return Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
}

export function UndoHost() {
  const qc = useQueryClient();
  const [undo, setUndo] = useState<Undo | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'late' | 'error'>('idle');
  const [message, setMessage] = useState('');
  useEffect(() => {
    push = (u) => { setUndo(u); setState('idle'); };
    return () => { push = null; };
  }, []);
  useEffect(() => {
    if (!undo) return;
    const left = undo.undoUntil - Date.now();
    const t = setTimeout(() => setUndo((cur) => (cur === undo ? null : cur)), Math.max(0, left) + (state === 'idle' || state === 'busy' ? 0 : 2500));
    return () => clearTimeout(t);
  }, [undo, state]);
  if (!undo) return null;

  const restore = async () => {
    setState('busy');
    try {
      await (undo.run ? undo.run() : api.restoreSessions(undo.inst, undo.ids));
      setUndo(null);
    } catch (err) {
      // a reply that does not stop: the server's message, and the button stays
      const late = err instanceof ApiError && err.status === 409 && (err.data as { code?: string } | undefined)?.code !== 'run_active';
      setState(late ? 'late' : 'error');
      setMessage((err as Error).message);
    }
    await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
  };

  return createPortal(
    <div role="status" data-undo className="enter fixed inset-x-0 bottom-20 z-[60] flex justify-center px-3 md:bottom-6">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-ink px-4 py-2 text-sm text-paper shadow-[0_12px_32px_rgb(22_24_27/0.25)]">
        <span>{state === 'late' ? 'Trop tard : la suppression est faite' : state === 'error' ? message : undo.label}</span>
        {(state === 'idle' || state === 'busy' || state === 'error') && (
          <Button variant="ghost" className="h-8 px-3 text-paper hover:bg-paper/10 hover:text-paper" onClick={() => void restore()} disabled={state === 'busy'}>
            Annuler
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}
