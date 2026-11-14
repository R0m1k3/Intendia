// Follow-up of a skills hub action (install, uninstall, update). Hermes runs them in the background and
// reports `running` / `exit_code`; the pending actions live in sessionStorage so a reload resumes them.
import type { ActionStatus } from '../api';
import { t } from '../i18n';

export const ACTION_POLL_MS = 1_500;
export const ACTION_MAX_MS = 5 * 60_000;

export interface PendingAction {
  action: string;
  /** French label, e.g. « Installation de pdf ». */
  label: string;
  /** Skill name or hub identifier the action concerns ('*' for update). */
  target: string;
  startedAt: number;
}

export type ActionState = 'running' | 'done' | 'failed' | 'lost' | 'stale';

/** `gone`: Hermes no longer knows the action (404, e.g. dashboard restarted). */
export function actionState(status: ActionStatus | 'gone' | undefined, startedAt: number, now = Date.now()): ActionState {
  if (status === 'gone') return 'lost';
  if (status && !status.running) return status.exitCode === 0 ? 'done' : 'failed';
  if (now - startedAt > ACTION_MAX_MS) return 'stale';
  return 'running';
}

/** Hermes' error line in the log, else the last line. */
export function failureLine(lines: string[]): string {
  const err = [...lines].reverse().find((l) => /^(Error|Installation blocked)/.test(l.trim()));
  return (err ?? lines.filter((l) => l.trim()).at(-1) ?? t('échec sans message')).trim();
}

export const STATE_TEXT: Record<Exclude<ActionState, 'failed'>, string> = {
  running: t('en cours…'),
  done: t('terminé'),
  lost: t('suivi perdu, la liste a été rechargée'),
  stale: t('toujours en cours, vérifier plus tard'),
};

const key = (inst: string, profile: string) => `intendia:skill-actions:${inst}:${profile}`;

export function loadActions(inst: string, profile: string, store: Pick<Storage, 'getItem'> = sessionStorage): PendingAction[] {
  try {
    const v = JSON.parse(store.getItem(key(inst, profile)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((a): a is PendingAction => Boolean(a && typeof a.action === 'string' && typeof a.startedAt === 'number')) : [];
  } catch {
    return [];
  }
}

export function saveActions(inst: string, profile: string, actions: PendingAction[], store: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage) {
  if (actions.length) store.setItem(key(inst, profile), JSON.stringify(actions));
  else store.removeItem(key(inst, profile));
}
