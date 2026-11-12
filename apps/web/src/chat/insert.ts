/**
 * Inserts `text` at the selection [start, end) of `value`, with a space before when the character before is not
 * blank and a space after when the next one is not; an empty field gets the text alone. Returns the new value and
 * the caret, placed after the inserted text (and its space).
 */
export function insertAt(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  if (!value) return { value: text, caret: text.length };
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = !after || !/^\s/.test(after) ? ' ' : '';
  const inserted = `${pre}${text}${post}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}
