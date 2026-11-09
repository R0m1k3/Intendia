import { describe, expect, it } from 'vitest';
import { fileKind, findPathCandidates } from './paths';

const m = { agentMount: '/opt/data/workspace', mount: '/workspace' };

describe('findPathCandidates', () => {
  it('finds absolute paths on both sides of the volume and relative workspace paths', () => {
    const text = 'Voir /opt/data/workspace/dev/sessions/iw-1/rapport.md, puis /workspace/dev/files/a.csv et files/b.txt ou AGENTS.md.';
    expect(findPathCandidates(text, m)).toEqual([
      '/opt/data/workspace/dev/sessions/iw-1/rapport.md', '/workspace/dev/files/a.csv', 'files/b.txt', 'AGENTS.md',
    ]);
  });

  it('strips final punctuation and brackets, reads inside backticks', () => {
    expect(findPathCandidates('(`inbox/photo.jpg`): ok', m)).toEqual(['inbox/photo.jpg']);
    expect(findPathCandidates('fichier inbox/x.pdf;', m)).toEqual(['inbox/x.pdf']);
    expect(findPathCandidates('dans files/sub/.', m)).toEqual(['files/sub']);
  });

  it('ignores paths inside URLs and other prefixes', () => {
    expect(findPathCandidates('https://example.com/files/a.md et /opt/data/workspace-x/a', m)).toEqual([]);
    expect(findPathCandidates('/srv/files/a.md', m)).toEqual([]);
    expect(findPathCandidates('myfiles/a.md', m)).toEqual([]);
  });

  it('deduplicates', () => {
    expect(findPathCandidates('files/a.md files/a.md', m)).toEqual(['files/a.md']);
  });
});

describe('fileKind', () => {
  it('maps extensions', () => {
    expect(fileKind('a.PNG')).toBe('image');
    expect(fileKind('a.svg')).toBe('svg');
    expect(fileKind('a.md')).toBe('markdown');
    expect(fileKind('a.ts')).toBe('text');
    expect(fileKind('Dockerfile')).toBe('text');
    expect(fileKind('a.bin')).toBe('other');
  });
});
