/** Text without case nor accents, for local filters ("Électricité" → "electricite"). */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a query, folded. */
export const wordsOf = (q: string): string[] => fold(q).split(/\s+/).filter(Boolean);

/** Every word is in the text (folded). */
export function matchesAll(words: string[], text: string): boolean {
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}
