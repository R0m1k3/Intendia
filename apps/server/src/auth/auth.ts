import { hash, verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { randomToken, safeEqual, sign } from '../crypto.js';
import { msg } from '../i18n/index.js';
import type { Db } from '../db/index.js';
import { authSessions, settings } from '../db/schema.js';

export const COOKIE = 'intendia_session';
/** Life of a session without use; each day of use pushes it back, up to MAX_DAYS after sign-in. */
const SESSION_DAYS = 30;
const MAX_DAYS = 90;
const DAY_MS = 86_400_000;
const EPOCH_KEY = 'password_epoch';
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export class Auth {
  /** One-time code required to choose the first password (printed in the logs). */
  readonly setupCode: string | null;
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly db: Db, private readonly config: AppConfig) {
    this.setupCode = this.passwordHash() ? null : randomToken(8);
    this.syncPasswordEpoch();
  }

  /**
   * Purges every session when the password hash changed since the last start (HMAC of the hash kept in
   * `settings.password_epoch`, never the hash itself). First run with this key: written without a purge.
   */
  syncPasswordEpoch(): void {
    const epoch = sign(this.config.secret, this.passwordHash() ?? '', { purpose: 'password-epoch-v1' });
    const stored = this.db.select().from(settings).where(eq(settings.key, EPOCH_KEY)).get()?.value;
    if (stored === epoch) return;
    if (stored !== undefined) this.db.delete(authSessions).run();
    this.db.insert(settings).values({ key: EPOCH_KEY, value: epoch })
      .onConflictDoUpdate({ target: settings.key, set: { value: epoch } }).run();
  }

  passwordHash(): string | undefined {
    if (this.config.passwordHash) return this.config.passwordHash;
    return this.db.select().from(settings).where(eq(settings.key, 'password_hash')).get()?.value;
  }

  needsPassword(): boolean {
    return !this.passwordHash();
  }

  async setInitialPassword(code: string, password: string): Promise<void> {
    if (!this.needsPassword() || !this.setupCode) throw new AuthError(409, msg('Un mot de passe est déjà défini'));
    if (!safeEqual(code.trim(), this.setupCode)) throw new AuthError(403, msg("Code d'installation incorrect"));
    if (password.length < 12) throw new AuthError(400, msg('Le mot de passe doit faire au moins 12 caractères'));
    const value = await hash(password, { algorithm: 2 /* Argon2id */ });
    this.db.insert(settings).values({ key: 'password_hash', value }).onConflictDoNothing().run();
    this.syncPasswordEpoch();
  }

  /** 5 attempts per minute and per IP. */
  rateLimit(ip: string): void {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) throw new AuthError(429, msg('Trop d’essais, réessayez dans une minute'));
    recent.push(now);
    this.attempts.set(ip, recent);
  }

  async checkPassword(password: string): Promise<boolean> {
    const h = this.passwordHash();
    if (!h) return false;
    try {
      return await verify(h, password);
    } catch {
      return false;
    }
  }

  createSession(c: Context): void {
    const id = randomToken(32);
    const now = Date.now();
    const expiresAt = now + SESSION_DAYS * DAY_MS;
    this.db.insert(authSessions).values({ id, createdAt: now, expiresAt }).run();
    this.db.delete(authSessions).where(lt(authSessions.expiresAt, now)).run();
    setCookie(c, COOKIE, id, this.cookieOptions(c, SESSION_DAYS * 86_400));
  }

  /** Signs out every browser (all rows deleted), then gives the caller a fresh session. */
  revokeAll(c: Context): void {
    this.db.delete(authSessions).run();
    this.createSession(c);
  }

  /** The valid session row of the request's cookie, or null. */
  session(c: Context): { id: string; createdAt: number; expiresAt: number } | null {
    const id = getCookie(c, COOKIE);
    if (!id) return null;
    const row = this.db.select().from(authSessions).where(eq(authSessions.id, id)).get();
    return row && row.expiresAt > Date.now() ? row : null;
  }

  /** Sliding session: pushes the end to min(now + 30 d, sign-in + 90 d), only when that gains a day or more. */
  extend(c: Context, row: { id: string; createdAt: number; expiresAt: number }): void {
    const now = Date.now();
    const next = Math.min(now + SESSION_DAYS * DAY_MS, row.createdAt + MAX_DAYS * DAY_MS);
    if (next - row.expiresAt < DAY_MS) return;
    this.db.update(authSessions).set({ expiresAt: next }).where(eq(authSessions.id, row.id)).run();
    setCookie(c, COOKIE, row.id, this.cookieOptions(c, Math.floor((next - now) / 1000)));
  }

  private cookieOptions(c: Context, maxAge: number) {
    return { httpOnly: true, secure: this.isSecure(c), sameSite: 'Strict' as const, path: '/', maxAge };
  }

  destroySession(c: Context): void {
    const id = getCookie(c, COOKIE);
    if (id) this.db.delete(authSessions).where(eq(authSessions.id, id)).run();
    deleteCookie(c, COOKIE, { path: '/' });
  }

  isAuthenticated(c: Context): boolean {
    return Boolean(this.session(c));
  }

  /**
   * `Secure` only when this request really came over https: a browser drops a Secure cookie set over http
   * (LAN address `http://192.168.x.x:3000` next to an https public address), and the login screen came back.
   */
  private isSecure(c: Context): boolean {
    const proto = this.config.trustProxy ? c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() : undefined;
    if (proto) return proto === 'https';
    const url = new URL(c.req.url);
    if (url.protocol === 'https:') return true;
    // a proxy that sends no X-Forwarded-Proto: trust the public address, but only for its own host
    const host = (this.config.trustProxy ? c.req.header('x-forwarded-host')?.split(',')[0]?.trim() : undefined) ?? c.req.header('host') ?? url.host;
    const pub = this.config.publicUrl ? new URL(this.config.publicUrl) : null;
    return Boolean(pub && pub.protocol === 'https:' && pub.host === host);
  }

  clientIp(c: Context): string {
    if (this.config.trustProxy) {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    return env?.incoming?.socket?.remoteAddress ?? 'unknown';
  }
}

export class AuthError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 409 | 429, message: string) {
    super(message);
  }
}

/** Session required; mutating requests must also carry `X-Intendia: 1` (CSRF guard on top of SameSite=Strict). */
export function requireAuth(auth: Auth): MiddlewareHandler {
  return async (c, next) => {
    const row = auth.session(c);
    if (!row) return c.json({ error: msg('Session expirée : reconnectez-vous'), code: 'unauthenticated' }, 401);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-intendia') !== '1') {
      return c.json({ error: msg('En-tête X-Intendia manquant : requête refusée'), code: 'csrf' }, 403);
    }
    auth.extend(c, row);
    await next();
  };
}
