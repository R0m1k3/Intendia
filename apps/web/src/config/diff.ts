/** Line diff (longest common subsequence after trimming the common head and tail). */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const n = x.length;
  const m = y.length;
  // lcs[i][j] = LCS length of x[i..] and y[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { mid.push({ kind: 'same', text: x[i]! }); i++; j++; }
    // deletions first on a tie (usual diff order: - then +)
    else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) { mid.push({ kind: 'del', text: x[i]! }); i++; }
    else { mid.push({ kind: 'add', text: y[j]! }); j++; }
  }
  return [
    ...a.slice(0, head).map((text) => ({ kind: 'same' as const, text })),
    ...mid,
    ...a.slice(a.length - tail).map((text) => ({ kind: 'same' as const, text })),
  ];
}

export type Hunk = { start: number; lines: DiffLine[] } | { skipped: number };

/** Changed lines with `context` unchanged lines around them; long unchanged runs become `{skipped}`. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const keep = lines.map((l) => l.kind !== 'same');
  const show = lines.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) if (keep[k]) return true;
    return false;
  });
  const out: Hunk[] = [];
  let line = 1;
  for (let i = 0; i < lines.length;) {
    if (show[i]) {
      const start = line;
      const chunk: DiffLine[] = [];
      while (i < lines.length && show[i]) { chunk.push(lines[i]!); if (lines[i]!.kind !== 'add') line++; i++; }
      out.push({ start, lines: chunk });
    } else {
      let skipped = 0;
      while (i < lines.length && !show[i]) { skipped++; line++; i++; }
      out.push({ skipped });
    }
  }
  return out;
}

export function changed(lines: DiffLine[]): number {
  return lines.filter((l) => l.kind !== 'same').length;
}
