import { describe, expect, it } from 'vitest';
import { nextCursor, olderOffset } from './older-pages';

/** Hermes' messages route: `limit` rows from the end after `offset` raw rows; hidden rows dropped like the server. */
const rows = [
  ...Array.from({ length: 300 }, (_, i) => ({ id: i + 1, hidden: false })), // older messages
  ...Array.from({ length: 500 }, (_, i) => ({ id: 301 + i, hidden: true })),
  ...Array.from({ length: 500 }, (_, i) => ({ id: 801 + i, hidden: false })), // recent messages
];
function page(offset: number) {
  const raw = rows.slice(Math.max(0, rows.length - offset - 500), Math.max(0, rows.length - offset));
  return { messages: raw.filter((r) => !r.hidden), hasMore: raw.length >= 500, nextOffset: offset + raw.length };
}

describe('older pages', () => {
  it('500 shown, 500 hidden, then older ones: the cursor moves past the hidden page and reaches the oldest', () => {
    const latest = page(0);
    let cursor: number | null = null;
    const shown = new Set(latest.messages.map((m) => m.id));
    const asked: number[] = [];
    for (let hasMore = latest.hasMore; hasMore;) {
      const offset = olderOffset(cursor, latest, shown.size - latest.messages.length);
      asked.push(offset);
      const res = page(offset);
      for (const m of res.messages) shown.add(m.id);
      cursor = nextCursor(offset, res);
      hasMore = res.hasMore;
    }
    expect(asked).toEqual([500, 1000]);
    expect(shown.size).toBe(800);
    expect(shown.has(1)).toBe(true);
  });

  it('without a server cursor: the messages shown', () => {
    expect(olderOffset(null, { messages: [1, 2] }, 3)).toBe(5);
    expect(nextCursor(10, { messages: [1, 2] })).toBe(12);
  });
});
