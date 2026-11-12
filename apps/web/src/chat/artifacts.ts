// « ::artefact <path>.html » lines of the agent's replies: an HTML page shown in the thread (Artifact.tsx).

export type ArtifactPiece = { kind: 'md'; text: string } | { kind: 'artifact'; path: string };

// at most 3 spaces before it: 4 make an indented code block
const LINE = /^ {0,3}::artefact[ \t]+(\S+\.html?)[ \t]*$/i;
// CommonMark fences: an opening run of 3+ ` or ~ (up to 3 spaces before), closed by a run of the same character at
// least as long with nothing after it
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The reply cut into Markdown and artefacts; a line inside a code block is never an artefact. */
export function splitArtifacts(text: string): ArtifactPiece[] {
  const out: ArtifactPiece[] = [];
  let md: string[] = [];
  let fence: string | null = null;
  const isFence = (line: string): string | null => {
    const m = FENCE.exec(line);
    if (!m) return null;
    if (fence === null) return m[1]![0] === '`' && m[2]!.includes('`') ? null : m[1]!;
    return m[1]![0] === fence[0] && m[1]!.length >= fence.length && !m[2]!.trim() ? m[1]! : null;
  };
  const flush = () => {
    if (md.join('').trim()) out.push({ kind: 'md', text: md.join('\n') });
    md = [];
  };
  for (const line of text.split('\n')) {
    const inside: boolean = fence !== null;
    const f = isFence(line);
    if (f) fence = inside ? null : f;
    const m = !inside && !f ? LINE.exec(line) : null;
    if (m) {
      flush();
      out.push({ kind: 'artifact', path: m[1]! });
    } else md.push(line);
  }
  flush();
  return out;
}

/** Paths of the artefacts of a reply, in order, without duplicates. */
export function artifactPaths(text: string): string[] {
  return [...new Set(splitArtifacts(text).flatMap((p) => (p.kind === 'artifact' ? [p.path] : [])))];
}
