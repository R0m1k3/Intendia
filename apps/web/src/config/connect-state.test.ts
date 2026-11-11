import { describe, expect, it } from 'vitest';
import { loadConnect, nextPollDelay, resumable, saveConnect, type PendingConnect } from './connect-state';

const saved: PendingConnect = {
  provider: 'nous', sessionId: 's1', userCode: 'ABCD', verificationUrl: 'https://example.test/device', pollInterval: 5, expiresIn: 900, startedAt: 1_000,
};

function memory() {
  const m = new Map<string, string>();
  const removed: string[] = [];
  return {
    m, removed,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => { removed.push(k); m.delete(k); },
  };
}

describe('provider login in progress', () => {
  it('keeps the poll delay between 2 and 10 s', () => {
    expect(nextPollDelay(1)).toBe(2_000);
    expect(nextPollDelay(5)).toBe(5_000);
    expect(nextPollDelay(30)).toBe(10_000);
    expect(nextPollDelay(undefined)).toBe(5_000);
    expect(nextPollDelay(null)).toBe(5_000);
  });

  it('resumes only before the session expires', () => {
    expect(resumable(saved, 1_000 + 899_000)).toBe(true);
    expect(resumable(saved, 1_000 + 900_000)).toBe(false);
    expect(resumable({ ...saved, expiresIn: null }, 1_000 + 899_000)).toBe(true);
    expect(resumable(null)).toBe(false);
  });

  it('saves, reads back and clears; tolerates an unreadable value', () => {
    const s = memory();
    saveConnect('a', 'default', saved, s);
    expect(loadConnect('a', 'default', s)).toEqual(saved);
    expect(loadConnect('a', 'coder', s)).toBeNull();
    saveConnect('a', 'default', null, s);
    expect(s.removed).toEqual(['intendia:provider-connect:a:default']);
    s.m.set('intendia:provider-connect:a:default', '{not json');
    expect(loadConnect('a', 'default', s)).toBeNull();
    s.m.set('intendia:provider-connect:a:default', JSON.stringify({ provider: 'nous' }));
    expect(loadConnect('a', 'default', s)).toBeNull();
  });
});
