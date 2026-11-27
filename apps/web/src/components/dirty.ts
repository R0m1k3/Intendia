import { useBlocker } from '@tanstack/react-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ask } from './Dialog';
import { t } from '../i18n';

/**
 * Registry of the screens holding unsaved text. One question for all of them: `confirmClose` before closing a
 * sheet or a preview, and the single `DirtyBlocker` (mounted by `Layout`) before a navigation or a reload.
 * Confirming discards the registered screens until the next task only, so a close that navigates is not asked
 * twice; a screen still mounted (and modified) after that close is guarded again.
 */
const active = new Set<symbol>();
const discarded = new Set<symbol>();
const guarded = (): boolean => [...active].some((id) => !discarded.has(id));
// the « Modifications non enregistrées » mark follows the registry
const watchers = new Set<() => void>();
const changed = () => { for (const w of watchers) w(); };
const watch = (w: () => void) => { watchers.add(w); return () => { watchers.delete(w); }; };

/** Registers this screen while `dirty`; `release()` removes it at once (before a close or a navigation on success). */
export function useDirtyGuard(dirty: boolean): { release(): void } {
  const id = useRef<symbol>(Symbol('dirty'));
  useEffect(() => {
    if (!dirty) return;
    const me = id.current;
    active.add(me);
    changed();
    return () => { active.delete(me); discarded.delete(me); changed(); };
  }, [dirty]);
  return { release: () => { active.delete(id.current); discarded.delete(id.current); changed(); } };
}

export function isDirty(): boolean {
  return guarded();
}

/** True while a screen holds unsaved text (re-renders when that changes). */
export function useAnyDirty(): boolean {
  return useSyncExternalStore(watch, () => active.size > 0);
}

/** Asks whether to discard the typed text; true = discard (the screens are skipped until the next task). */
export async function confirmDiscard(): Promise<boolean> {
  const ok = await ask({
    title: t('Abandonner les modifications ?'),
    message: t('Ce que vous avez saisi sera perdu.'),
    confirmLabel: t('Abandonner'),
    danger: true,
  });
  if (ok) {
    for (const id of active) discarded.add(id);
    setTimeout(() => discarded.clear(), 0);
  }
  return ok;
}

/** Runs `close` at once when nothing is modified, otherwise after the user agreed to discard. */
export async function confirmClose(close: () => void): Promise<boolean> {
  if (!guarded()) { close(); return true; }
  if (!(await confirmDiscard())) return false;
  close();
  return true;
}

/** The only router blocker: navigation (search changes included) and reload while a screen is modified. */
export function DirtyBlocker() {
  useBlocker({
    shouldBlockFn: async () => {
      if (!guarded()) return false;
      return !(await confirmDiscard());
    },
    enableBeforeUnload: guarded,
  });
  return null;
}

/** Tests only. */
export function _resetDirty(): void {
  active.clear();
  discarded.clear();
  changed();
}
