// Older pages of a thread: the cursor is the raw rows already read at Hermes (the server's `nextOffset`, hidden and
// session_meta rows included), kept apart from the messages shown. Counting the shown messages instead would stall
// on a page of hidden rows only: the same offset asked again and again.

/** Offset of the next older page: the last older page's cursor, else the latest page's, else the messages shown. */
export function olderOffset(cursor: number | null, latest: { nextOffset?: number; messages: unknown[] }, olderShown: number): number {
  return cursor ?? latest.nextOffset ?? latest.messages.length + olderShown;
}

/** Cursor after a page read at `offset` (the server's `nextOffset`; without it, the messages it gave). */
export function nextCursor(offset: number, page: { nextOffset?: number; messages: unknown[] }): number {
  return page.nextOffset ?? offset + page.messages.length;
}
