import { describe, expect, it } from 'vitest';
import { normalizeRel, toVolumePath } from '../src/files/paths.js';
import { WorkspaceFsError } from '../src/workspaces/fs.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof WorkspaceFsError ? err.code : String(err);
  }
  return 'ok';
};

describe('normalizeRel', () => {
  it('refuses traversal, absolute paths, NUL, backslashes and long input', () => {
    for (const bad of ['../x', 'files/../../x', 'a/../b', '/etc/passwd', 'a\0b', 'a\\b', 'x'.repeat(1025)]) {
      expect(code(() => normalizeRel(bad)), bad).toBe('invalid');
    }
  });
  it('normalizes . and slashes; empty is the root only when allowed', () => {
    expect(normalizeRel('./files//a.md/')).toBe('files/a.md');
    expect(normalizeRel('', { allowRoot: true })).toBe('');
    expect(code(() => normalizeRel(''))).toBe('invalid');
  });
});

describe('toVolumePath', () => {
  const inst = '/opt/data/workspace';
  it('maps agent paths to volume paths (relative to the workspace root)', () => {
    expect(toVolumePath('/opt/data/workspace/dev/files/a.md', inst)).toBe('dev/files/a.md');
    expect(toVolumePath('/opt/data/workspace/dev/a.md', '/opt/data/workspace/')).toBe('dev/a.md');
    expect(toVolumePath('/opt/data/workspace/../etc/passwd', inst)).toBeNull();
    expect(toVolumePath('/etc/passwd', inst)).toBeNull();
    expect(toVolumePath('/opt/data/workspace-x/a', inst)).toBeNull();
    expect(toVolumePath('dev/a.md', inst)).toBeNull();
  });
});
