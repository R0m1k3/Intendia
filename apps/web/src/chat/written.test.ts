import { describe, expect, it } from 'vitest';
import type { Entry } from './events';
import { writtenPaths } from './written';

const tool = (key: string, name: string, args: unknown, ts = 1): Entry => ({
  kind: 'tool', key, callId: null, tool: name, preview: JSON.stringify(args), result: '{}', duration: null, state: 'ok', ts,
});

describe('writtenPaths', () => {
  it('write_file, patch replace, V4A Add / Update / Delete / Move, also without the space after ***', () => {
    const patch = ['*** Begin Patch', '*** Update File: /w/a.md', '***Update File: /w/b.md', '*** Add File: /w/c.md',
      '*** Delete File: /w/d.md', '*** Move File: /w/e.md -> /w/f.md', '*** End Patch'].join('\n');
    expect(writtenPaths([
      tool('h1-0', 'write_file', { path: '/w/x.md', content: 'x' }, 1),
      tool('h2-0', 'patch', { mode: 'replace', path: '/w/y.md', old_string: 'a', new_string: 'b' }, 2),
      tool('h3-0', 'patch', { mode: 'patch', patch }, 3),
    ])).toEqual([
      { path: '/w/f.md', ts: 3, op: 'patch' }, { path: '/w/e.md', ts: 3, op: 'delete' }, { path: '/w/d.md', ts: 3, op: 'delete' },
      { path: '/w/c.md', ts: 3, op: 'patch' }, { path: '/w/b.md', ts: 3, op: 'patch' }, { path: '/w/a.md', ts: 3, op: 'patch' },
      { path: '/w/y.md', ts: 2, op: 'patch' }, { path: '/w/x.md', ts: 1, op: 'write' },
    ]);
  });

  it('live entries ignored; for one path the last operation decides; bad arguments ignored', () => {
    expect(writtenPaths([
      tool('h1-0', 'write_file', { path: 'files/a.md' }, 1),
      tool('t5', 'write_file', { path: 'files/live.md' }, 2),
      tool('h2-0', 'patch', { mode: 'patch', patch: '*** Delete File: files/a.md' }, 3),
      tool('h3-0', 'write_file', { path: 'files/a.md' }, 4),
      tool('h4-0', 'terminal', { command: 'ls' }, 5),
      { ...tool('h5-0', 'write_file', {}), preview: 'pas du json' } as Entry,
    ])).toEqual([{ path: 'files/a.md', ts: 4, op: 'write' }]);
  });
});
