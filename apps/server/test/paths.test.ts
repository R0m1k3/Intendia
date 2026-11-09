import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeRel, resolveEntry, resolveInside, toVolumePath } from '../src/files/paths.js';
import { WorkspaceFsError } from '../src/workspaces/fs.js';
import { tempDir } from './helpers.js';

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

describe('resolveInside', () => {
  const setup = () => {
    const root = tempDir();
    const ws = join(root, 'ws');
    mkdirSync(join(ws, 'files', 'sub'), { recursive: true });
    writeFileSync(join(ws, 'files', 'sub', 'a.txt'), 'a');
    symlinkSync('/etc', join(ws, 'files', 'out'));
    symlinkSync(join(ws, 'files', 'sub'), join(ws, 'files', 'ok'));
    symlinkSync(join(ws, 'nowhere'), join(ws, 'files', 'dangling'));
    mkdirSync(join(root, 'other'));
    writeFileSync(join(root, 'other', 'secret'), 's');
    symlinkSync(join(root, 'other'), join(ws, 'files', 'sibling'));
    return ws;
  };

  it('follows links that stay inside and refuses links that leave', () => {
    const ws = setup();
    expect(resolveInside(ws, 'files/ok/a.txt', 'existing')).toMatch(/files\/sub\/a\.txt$/);
    expect(code(() => resolveInside(ws, 'files/out/passwd', 'existing'))).toBe('outside');
    expect(code(() => resolveInside(ws, 'files/sibling/secret', 'existing'))).toBe('outside');
    expect(code(() => resolveInside(ws, 'files/missing', 'existing'))).toBe('not_found');
  });

  it('create: parent must stay inside, the name must not exist (dangling link included)', () => {
    const ws = setup();
    expect(resolveInside(ws, 'files/new.txt', 'create')).toMatch(/files\/new\.txt$/);
    expect(code(() => resolveInside(ws, 'files/out/new.txt', 'create'))).toBe('outside');
    expect(code(() => resolveInside(ws, 'files/dangling', 'create'))).toBe('exists');
    expect(code(() => resolveInside(ws, 'files/sub/a.txt', 'create'))).toBe('exists');
  });

  it('resolveEntry acts on a link itself, but refuses a parent that leaves', () => {
    const ws = setup();
    expect(resolveEntry(ws, 'files/out')).toMatch(/files\/out$/);
    expect(code(() => resolveEntry(ws, 'files/out/passwd'))).toBe('outside');
  });
});

describe('toVolumePath', () => {
  const inst = { mount: '/srv/vol', agentMount: '/opt/data/workspace' };
  it('maps agent and Intendia paths to mount-relative paths', () => {
    expect(toVolumePath('/opt/data/workspace/dev/files/a.md', inst)).toBe('dev/files/a.md');
    expect(toVolumePath('/srv/vol/dev/a.md', inst)).toBe('dev/a.md');
    expect(toVolumePath('/opt/data/workspace/../etc/passwd', inst)).toBeNull();
    expect(toVolumePath('/etc/passwd', inst)).toBeNull();
    expect(toVolumePath('/opt/data/workspace-x/a', inst)).toBeNull();
    expect(toVolumePath('dev/a.md', inst)).toBeNull();
  });
});
