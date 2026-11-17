import { useBlocker } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ask } from './Dialog';
import { t } from '../i18n';

/**
 * Registry of the screens holding unsaved text. One question for all of them: `confirmClose` before closing a
 * sheet or a preview, and the single `DirtyBlocker` (mounted by `Layout`) before a navigation or a reload.
 * Confirming clears the whole registry, so a close that navigates is not asked twice.
 */
const active = new Set<symbol>();

/** Registers this screen while `dirty`; `release()` removes it at once (before a close or a navigation on success). */
export function useDirtyGuard(dirty: boolean): { release(): void } {
  const id = useRef<symbol>(Symbol('dirty'));
  useEffect(() => {
    if (!dirty) return;
    const me = id.current;
    active.add(me);
    return () => { active.delete(me); };
  }, [dirty]);
  return { release: () => { active.delete(id.current); } };
}

export function isDirty(): boolean {
  return active.size > 0;
}

/** Asks whether to discard the typed text; true = discard (the registry is then cleared). */
export async function confirmDiscard(): Promise<boolean> {
  const ok = await ask({
    title: t('Abandonner les modifications ?'),
    message: t('Ce que vous avez saisi sera perdu.'),
    confirmLabel: t('Abandonner'),
    danger: true,
  });
  if (ok) active.clear();
  return ok;
}

/** Runs `close` at once when nothing is modified, otherwise after the user agreed to discard. */
export async function confirmClose(close: () => void): Promise<boolean> {
  if (!active.size) { close(); return true; }
  if (!(await confirmDiscard())) return false;
  close();
  return true;
}

/** The only router blocker: navigation (search changes included) and reload while a screen is modified. */
export function DirtyBlocker() {
  useBlocker({
    shouldBlockFn: async () => {
      if (!active.size) return false;
      return !(await confirmDiscard());
    },
    enableBeforeUnload: () => active.size > 0,
  });
  return null;
}

/** Tests only. */
export function _resetDirty(): void {
  active.clear();
}
