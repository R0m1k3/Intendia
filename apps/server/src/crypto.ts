import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base62 token (share links use 10 characters, sessions 32). */
export function randomToken(length: number): string {
  const out: string[] = [];
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      // reject bytes >= 248 to keep the distribution uniform over 62 symbols
      if (b < 248 && out.length < length) out.push(BASE62[b % 62]!);
    }
  }
  return out.join('');
}

function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'intendia', purpose, 32));
}

/** AES-256-GCM, output: base64url(iv | tag | ciphertext). */
export function encrypt(secret: string, plaintext: string, purpose = 'instances-v1'): string {
  const key = deriveKey(secret, purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

export function decrypt(secret: string, payload: string, purpose = 'instances-v1'): string {
  const raw = Buffer.from(payload, 'base64url');
  const key = deriveKey(secret, purpose);
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function sign(secret: string, value: string, opts: { purpose?: string; encoding?: 'base64url' | 'hex' } = {}): string {
  return createHmac('sha256', deriveKey(secret, opts.purpose ?? 'sign-v1')).update(value).digest(opts.encoding ?? 'base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
