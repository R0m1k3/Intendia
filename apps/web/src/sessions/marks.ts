/** A snippet of Hermes' search cut into text pieces, `hit` for the words between `>>>` and `<<<` (never HTML). */
export function splitMarks(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let rest = snippet;
  while (rest) {
    const open = rest.indexOf('>>>');
    const close = open < 0 ? -1 : rest.indexOf('<<<', open + 3);
    if (open < 0 || close < 0) {
      out.push({ text: rest, hit: false });
      break;
    }
    if (open > 0) out.push({ text: rest.slice(0, open), hit: false });
    if (close > open + 3) out.push({ text: rest.slice(open + 3, close), hit: true });
    rest = rest.slice(close + 3);
  }
  return out;
}
