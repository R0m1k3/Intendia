import { describe, expect, it } from 'vitest';
import type { FsEntry } from '../src/files/hermes-fs.js';
import { idleGuard, walk } from '../src/files/walk.js';

const f = (name: string, size = 1): FsEntry => ({ name, vol: name, isDir: false, isLink: false, broken: false, size, mtimeMs: 1 });
const d = (name: string): FsEntry => ({ ...f(name, 0), isDir: true });
const l = (name: string): FsEntry => ({ ...f(name, 0), isLink: true });

function tree(t: Record<string, FsEntry[]>) {
  const read: string[] = [];
  const list = async (rel: string) => {
    read.push(rel);
    const e = t[rel];
    if (!e) throw new Error(`illisible : ${rel}`);
    return e;
  };
  return { list, read };
}

const opts = { maxFiles: 10, maxBytes: 100, maxFileBytes: 50, links: 'fail' as const };

describe('walk', () => {
  it('every folder (empty ones too) and file, relative to the root', async () => {
    const { list } = tree({ r: [f('a.txt', 3), d('s'), d('vide')], 'r/s': [f('b.txt', 4), d('t')], 'r/vide': [], 'r/s/t': [] });
    const res = await walk(list, 'r', opts);
    expect(res.dirs.sort()).toEqual(['s', 's/t', 'vide']);
    expect(res.files).toEqual([{ rel: 'a.txt', size: 3, mtimeMs: 1 }, { rel: 's/b.txt', size: 4, mtimeMs: 1 }]);
  });

  it('stops at the first limit passed, without listing further', async () => {
    const big = { r: [f('a', 1), f('b', 1), d('s')], 'r/s': [f('c', 1)] };
    for (const o of [{ maxFiles: 1 }, { maxBytes: 1 }, { maxFileBytes: 0 }]) {
      const { list, read } = tree(big);
      await expect(walk(list, 'r', { ...opts, ...o, tooLarge: 'trop' })).rejects.toMatchObject({ code: 'too_large', message: 'trop' });
      expect(read).toEqual(['r']);
    }
  });

  it('links: fail → outside, skip → left out', async () => {
    const t = { r: [f('a'), l('lien')] };
    await expect(walk(tree(t).list, 'r', opts)).rejects.toMatchObject({ code: 'outside' });
    expect((await walk(tree(t).list, 'r', { ...opts, links: 'skip' })).files.map((x) => x.rel)).toEqual(['a']);
  });

  it('an unreadable folder fails the walk', async () => {
    await expect(walk(tree({ r: [d('s')] }).list, 'r', opts)).rejects.toThrow('illisible : r/s');
  });
});

describe('idleGuard', () => {
  it('passes the bytes through, cuts a silent stream with unreachable', async () => {
    const ok = new Response(idleGuard(new Response('abc').body!, 50));
    expect(await ok.text()).toBe('abc');
    let cancelled = false;
    const silent = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined), cancel: () => { cancelled = true; } });
    await expect(new Response(idleGuard(silent, 30)).text()).rejects.toMatchObject({ code: 'unreachable' });
    expect(cancelled).toBe(true);
  });
});
