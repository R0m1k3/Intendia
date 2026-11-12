import { describe, expect, it } from 'vitest';
import { artifactPaths, splitArtifacts } from './artifacts';

describe('artefacts', () => {
  it('turns a line of its own into an artefact, between the Markdown around it', () => {
    expect(splitArtifacts('Voici la page :\n::artefact /w/dev/sessions/s1/page.html\nBonne lecture.')).toEqual([
      { kind: 'md', text: 'Voici la page :' },
      { kind: 'artifact', path: '/w/dev/sessions/s1/page.html' },
      { kind: 'md', text: 'Bonne lecture.' },
    ]);
  });

  it('accepts spaces and .htm, ignores other names and lines with more text', () => {
    expect(splitArtifacts('  ::artefact   sessions/s1/a.htm  ')).toEqual([{ kind: 'artifact', path: 'sessions/s1/a.htm' }]);
    for (const t of ['::artefact sessions/s1/a.md', '::artefact', 'voir ::artefact sessions/a.html', '::artefact a.html b.html']) {
      expect(splitArtifacts(t), t).toEqual([{ kind: 'md', text: t }]);
    }
  });

  it('a line inside a code block stays code', () => {
    const t = 'Exemple :\n```\n::artefact sessions/a.html\n```\n::artefact sessions/b.html';
    expect(artifactPaths(t)).toEqual(['sessions/b.html']);
    expect(splitArtifacts(t)[0]).toEqual({ kind: 'md', text: 'Exemple :\n```\n::artefact sessions/a.html\n```' });
  });

  it('lists each path once', () => {
    expect(artifactPaths('::artefact a.html\n::artefact b.html\n::artefact a.html')).toEqual(['a.html', 'b.html']);
  });
});
