import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipFolder, zipSlot } from '../src/files/zip.js';

const stream = (s: string) => new Response(s).body!;
const bytes = async (r: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(r).arrayBuffer());

describe('zipFolder', () => {
  it('folders (empty ones too) and files under the folder name; unreadable files listed in _erreurs.txt', async () => {
    let ended = 0;
    const tree = {
      dirs: ['sous', 'sous/vide'],
      files: [{ rel: 'a.txt', size: 3, mtimeMs: 1_700_000_000_000 }, { rel: 'sous/b.png', size: 2, mtimeMs: 1 },
        { rel: 'parti.txt', size: 1, mtimeMs: 1 }, { rel: 'gros.bin', size: 200 * 1024 * 1024, mtimeMs: 1 }],
    };
    const z = zipFolder({
      name: 'Été 2026', tree, onEnd: () => ended++,
      read: async (rel) => { if (rel === 'parti.txt') throw new Error('Introuvable'); return stream(rel === 'a.txt' ? 'aaa' : 'pn'); },
    });
    const files = unzipSync(await bytes(z));
    expect(Object.keys(files).sort()).toEqual(['Été 2026/_erreurs.txt', 'Été 2026/a.txt', 'Été 2026/sous/', 'Été 2026/sous/b.png', 'Été 2026/sous/vide/']);
    expect(strFromU8(files['Été 2026/a.txt']!)).toBe('aaa');
    expect(strFromU8(files['Été 2026/_erreurs.txt']!)).toBe('parti.txt : Introuvable\ngros.bin : plus de 100 Mio, Hermes ne le lit pas\n');
    expect(ended).toBe(1);
  });

  it('a read cut in the middle: the entry is closed, the zip stays valid, the file is listed', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('début')); },
      pull(c) { c.error(new Error('Hermes coupé')); },
    });
    const z = zipFolder({ name: 'd', tree: { dirs: [], files: [{ rel: 'x.txt', size: 9, mtimeMs: 1 }] }, read: async () => broken });
    const files = unzipSync(await bytes(z));
    expect(strFromU8(files['d/_erreurs.txt']!)).toContain('x.txt : lecture interrompue');
  });

  it('a client that leaves ends the zip once (place freed)', async () => {
    let ended = 0;
    const z = zipFolder({
      name: 'd', onEnd: () => ended++,
      tree: { dirs: [], files: Array.from({ length: 50 }, (_, i) => ({ rel: `${i}.txt`, size: 1, mtimeMs: 1 })) },
      read: async () => stream('x'.repeat(100_000)),
    });
    const reader = z.getReader();
    await reader.read();
    await reader.cancel();
    expect(ended).toBe(1);
  });

  it('two places at most', () => {
    const a = zipSlot();
    const b = zipSlot();
    expect(() => zipSlot()).toThrow(expect.objectContaining({ code: 'busy' }));
    a();
    a(); // twice: freed once
    const c = zipSlot();
    expect(() => zipSlot()).toThrow();
    b();
    c();
  });
});
