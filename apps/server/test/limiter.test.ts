import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/auth/limiter.js';

describe('RateLimiter', () => {
  it('allows max hits per window, per key', () => {
    const l = new RateLimiter(2, 1000);
    expect(l.hit('a', 0)).toBe(true);
    expect(l.hit('a', 10)).toBe(true);
    expect(l.hit('a', 20)).toBe(false);
    expect(l.hit('b', 20)).toBe(true);
    expect(l.hit('a', 1005)).toBe(true);
  });
});
