/**
 * A provider login in progress (device code), kept in the tab's sessionStorage so that leaving the Fournisseurs tab
 * and coming back resumes it: Hermes saves the login as soon as it is approved, even with nobody polling, so the
 * login is cancelled only by the « Annuler » button. Same shape of code as `skills/action.ts`.
 */

export interface PendingConnect {
  provider: string;
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  /** Seconds, as Hermes gave it. */
  pollInterval: number | null;
  /** Seconds, as Hermes gave it (900 when missing). */
  expiresIn: number | null;
  startedAt: number;
}

const DEFAULT_EXPIRES_S = 900;

/** Delay before the next poll, in ms: Hermes's interval, kept between 2 and 10 s, 5 s when missing. */
export function nextPollDelay(interval: number | null | undefined): number {
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) return 5_000;
  return Math.min(10, Math.max(2, interval)) * 1_000;
}

/** Can this saved login still be followed (its Hermes session not expired)? */
export function resumable(saved: PendingConnect | null, now = Date.now()): boolean {
  if (!saved) return false;
  return now < saved.startedAt + (saved.expiresIn ?? DEFAULT_EXPIRES_S) * 1_000;
}

const key = (inst: string, profile: string) => `intendia:provider-connect:${inst}:${profile}`;

export function loadConnect(inst: string, profile: string, store: Pick<Storage, 'getItem'> = sessionStorage): PendingConnect | null {
  try {
    const v = JSON.parse(store.getItem(key(inst, profile)) ?? 'null') as Partial<PendingConnect> | null;
    if (!v || typeof v.provider !== 'string' || typeof v.sessionId !== 'string' || typeof v.userCode !== 'string'
      || typeof v.verificationUrl !== 'string' || typeof v.startedAt !== 'number') return null;
    return {
      provider: v.provider, sessionId: v.sessionId, userCode: v.userCode, verificationUrl: v.verificationUrl, startedAt: v.startedAt,
      pollInterval: typeof v.pollInterval === 'number' ? v.pollInterval : null,
      expiresIn: typeof v.expiresIn === 'number' ? v.expiresIn : null,
    };
  } catch {
    return null;
  }
}

export function saveConnect(inst: string, profile: string, value: PendingConnect | null, store: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage) {
  if (value) store.setItem(key(inst, profile), JSON.stringify(value));
  else store.removeItem(key(inst, profile));
}
