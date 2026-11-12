/** Refusals of the admin screens (lot 8): code + HTTP status, rendered by `app.onError` with `extra`. */
export type AdminCode =
  | 'refused' | 'multiplexed' | 'protected' | 'in_use' | 'too_long' | 'stale' | 'over_budget'
  | 'busy' | 'already_installed' | 'no_public_url';

const STATUS: Record<AdminCode, 400 | 409> = {
  refused: 409, multiplexed: 409, protected: 409, in_use: 409, too_long: 409, stale: 409, over_budget: 400,
  busy: 409, already_installed: 409, no_public_url: 409,
};

export class AdminError extends Error {
  readonly status: 400 | 409;
  constructor(readonly code: AdminCode, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AdminError';
    this.status = STATUS[code];
  }
}
