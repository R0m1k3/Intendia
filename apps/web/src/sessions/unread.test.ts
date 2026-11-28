import { describe, expect, it } from 'vitest';
import { countsAsUnread, isUnread, markAllSeen, markSeen, readSeen, SEEN_MAX } from './unread';

describe('unread sessions', () => {
  it('first visit: everything older is read; a session that moves after is unread until opened', () => {
    const st = readSeen(null, 1000);
    expect(isUnread(st, { id: 'a', at: 900 })).toBe(false);
    expect(isUnread(st, { id: 'a', at: 1100 })).toBe(true);
    const next = markSeen(st, 'a', 1100)!;
    expect(isUnread(next, { id: 'a', at: 1100 })).toBe(false);
    expect(isUnread(next, { id: 'a', at: 1200 })).toBe(true);
    expect(markSeen(next, 'a', 1050)).toBeNull();
  });

  it('broken storage starts fresh; the oldest entries go beyond the maximum', () => {
    expect(readSeen('{pas du json', 5)).toEqual({ base: 5, seen: {} });
    let st = readSeen(null, 0);
    for (let i = 1; i <= SEEN_MAX + 5; i++) st = markSeen(st, `s${i}`, i)!;
    expect(Object.keys(st.seen)).toHaveLength(SEEN_MAX);
    expect(st.seen.s1).toBeUndefined();
    expect(st.seen[`s${SEEN_MAX + 5}`]).toBe(SEEN_MAX + 5);
  });

  it('« Tout marquer comme lu »: everything before now is read, a later move is unread again', () => {
    const state = markAllSeen(1000);
    expect(isUnread(state, { id: 'a', at: 999 })).toBe(false);
    expect(isUnread(state, { id: 'a', at: 1001 })).toBe(true);
  });

  it('a cron’s runs never count as unread', () => {
    expect(countsAsUnread({ source: 'cron' })).toBe(false);
    expect(countsAsUnread({ source: 'telegram' })).toBe(true);
    expect(countsAsUnread({ source: null })).toBe(true);
  });
});
