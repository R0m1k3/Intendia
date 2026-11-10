import { hash, verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { randomToken, safeEqual } from '../crypto.js';
import type { Db } from '../db/index.js';
import { authSessions, settings } from '../db/schema.js';

export const COOKIE = 'intendia_session';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export class Auth {
  /** One-time code required to choose the first password (printed in the logs). */
  readonly setupCode: string | null;
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly db: Db, private readonly config: AppConfig) {
    this.setupCode = this.passwordHash() ? null : randomToken(8);
  }

  passwordHash(): string | undefined {
    if (this.config.passwordHash) return this.config.passwordHash;
    return this.db.select().from(settings).where(eq(settings.key, 'password_hash')).get()?.value;
  }

  needsPassword(): boolean {
    return !this.passwordHash();
  }

  async setInitialPassword(code: string, password: string): Promise<void> {
    if (!this.needsPassword() || !this.setupCode) throw new AuthError(409, 'Un mot de passe est déjà défini');
    if (!safeEqual(code.trim(), this.setupCode)) throw new AuthError(403, "Code d'installation incorrect");
    if (password.length < 12) throw new AuthError(400, 'Le mot de passe doit faire au moins 12 caractères');
    const value = await hash(password, { algorithm: 2 /* Argon2id */ });
    this.db.insert(settings).values({ key: 'password_hash', value }).onConflictDoNothing().run();
  }

  /** 5 attempts per minute and per IP. */
  rateLimit(ip: string): void {
    const now = Date.now();
    const recent = (this.attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) throw new AuthError(429, 'Trop d’essais, réessayez dans une minute');
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
    const expiresAt = now + SESSION_DAYS * 86_400_000;
    this.db.insert(authSessions).values({ id, createdAt: now, expiresAt }).run();
    this.db.delete(authSessions).where(lt(authSessions.expiresAt, now)).run();
    setCookie(c, COOKIE, id, {
      httpOnly: true,
      secure: this.isSecure(c),
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_DAYS * 86_400,
    });
  }

  destroySession(c: Context): void {
    const id = getCookie(c, COOKIE);
    if (id) this.db.delete(authSessions).where(eq(authSessions.id, id)).run();
    deleteCookie(c, COOKIE, { path: '/' });
  }

  isAuthenticated(c: Context): boolean {
    const id = getCookie(c, COOKIE);
    if (!id) return false;
    const row = this.db.select().from(authSessions).where(eq(authSessions.id, id)).get();
    return Boolean(row && row.expiresAt > Date.now());
  }

  private isSecure(c: Context): boolean {
    if (this.config.publicUrl) return this.config.publicUrl.startsWith('https://');
    const proto = this.config.trustProxy ? c.req.header('x-forwarded-proto') : undefined;
    return (proto ?? new URL(c.req.url).protocol.replace(':', '')) === 'https';
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
    if (!auth.isAuthenticated(c)) return c.json({ error: 'unauthenticated' }, 401);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-intendia') !== '1') {
      return c.json({ error: 'missing X-Intendia header' }, 403);
    }
    await next();
  };
}
