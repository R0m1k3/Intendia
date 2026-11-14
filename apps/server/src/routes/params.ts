import { msg } from '../i18n/index.js';
import { ValidationError } from '../workspaces/service.js';

/** Hermes profile name, as accepted in `?profile=` by every console route. */
export const PROFILE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Kanban board slug, as Hermes normalises it. */
export const BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Kanban task id (`t_` + hex in Hermes 0.23.0). */
export const TASK_RE = /^t_[a-z0-9]{4,32}$/;

/** Positive integer path parameter (kanban run ids), or a ValidationError. */
export function intParam(value: string | undefined, what: string): number {
  if (!value || !/^\d{1,12}$/.test(value)) throw new ValidationError(msg('{what} invalide', { what }));
  return Number(value);
}
