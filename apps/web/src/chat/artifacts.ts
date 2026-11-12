// « ::artefact <path>.html » lines of the agent's replies: an HTML page shown in the thread (Artifact.tsx).

export type ArtifactPiece = { kind: 'md'; text: string } | { kind: 'artifact'; path: string };

const LINE = /^::artefact\s+(\S+\.html?)\s*$/i;
const FENCE = /^\s*(```|~~~)/;

/** The reply cut into Markdown and artefacts; a line inside a code block is never an artefact. */
export function splitArtifacts(text: string): ArtifactPiece[] {
  const out: ArtifactPiece[] = [];
  let md: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (md.join('').trim()) out.push({ kind: 'md', text: md.join('\n') });
    md = [];
  };
  for (const line of text.split('\n')) {
    const f = FENCE.exec(line)?.[1];
    if (f) fence = fence === null ? f : fence === f ? null : fence;
    const m = fence === null ? LINE.exec(line.trim()) : null;
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
