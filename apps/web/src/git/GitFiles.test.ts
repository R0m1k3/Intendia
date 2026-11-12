import { describe, expect, it } from 'vitest';
import type { GitFile } from '../api';
import { groupFiles } from './GitFiles';

const f = (path: string, o: Partial<GitFile> = {}): GitFile => ({
  path, status: 'M', staged: false, unstaged: true, conflicted: false, added: 1, removed: 0, dir: false, sensitive: false, ...o,
});
const names = (l: GitFile[]) => l.map((x) => x.path);

describe('groupFiles', () => {
  it('puts each file where its changes are', () => {
    const g = groupFiles([
      f('seul-indexe', { staged: true, unstaged: false }),
      f('les-deux', { staged: true, unstaged: true }),
      f('inconnu', { staged: true, unstaged: null }),
      f('modifie'),
      f('neuf', { status: '?' }),
      f('dossier/', { status: '?', dir: true }),
      f('conflit', { status: 'U', conflicted: true, staged: true }),
    ]);
    expect(names(g.staged)).toEqual(['seul-indexe', 'les-deux', 'inconnu']);
    expect(names(g.unstaged)).toEqual(['les-deux', 'modifie']);
    expect(names(g.untracked)).toEqual(['neuf', 'dossier/']);
    expect(names(g.conflicted)).toEqual(['conflit']);
  });
});
