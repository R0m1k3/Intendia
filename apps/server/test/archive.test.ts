import { gzipSync, zipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveKind, archiveStem, ArchiveError, extractArchive, safePath, type ArchiveKind } from '../src/files/archive.js';
import { tempDir } from './helpers.js';

const enc = new TextEncoder();
const LIMITS = { maxEntries: 100, maxTotal: 10_000, maxFile: 5_000 };

/** A ustar archive by hand: entries [name, data | null (folder), type]. */
function tar(entries: [string, string | null, string?][]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, data, type] of entries) {
    const h = new Uint8Array(512);
    const body = data === null ? new Uint8Array(0) : enc.encode(data);
    const put = (off: number, s: string) => h.set(enc.encode(s), off);
    put(0, name);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(136, '00000000000\0');
    h[156] = (type ?? (data === null ? '5' : '0')).charCodeAt(0);
    put(257, 'ustar\0');
    put(263, '00');
    h.fill(32, 148, 156);
    const sum = h.reduce((a, b) => a + b, 0);
    put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
    blocks.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

async function run(bytes: Uint8Array, kind: ArchiveKind, limits = LIMITS, stop?: () => boolean) {
  const files: Record<string, string> = {};
  const res = await extractArchive(bytes, kind, limits, async (path, data) => {
    files[path] = new TextDecoder().decode(data);
    return 'written';
  }, stop);
  return { files, ...res };
}

describe('archive names', () => {
  it('kind and stem by extension', () => {
    expect(archiveKind('a.ZIP')).toBe('zip');
    expect(archiveKind('a.tar.gz')).toBe('tgz');
    expect(archiveKind('a.tgz')).toBe('tgz');
    expect(archiveKind('a.tar')).toBe('tar');
    expect(archiveKind('a.gz')).toBeNull();
    expect(archiveKind('.zip')).toBeNull();
    expect(archiveStem('Rapport.tar.gz')).toBe('Rapport');
    expect(archiveStem('Rapport.zip')).toBe('Rapport');
  });

  it('paths leaving the folder are refused, Windows separators kept as folders', () => {
    expect(safePath('a/../../x')).toEqual({ reason: 'chemin hors du dossier' });
    expect(safePath('/etc/passwd')).toEqual({ reason: 'chemin hors du dossier' });
    expect(safePath('C:/x')).toEqual({ reason: 'chemin hors du dossier' });
    expect(safePath('./a//b\\c.txt')).toEqual({ path: 'a/b/c.txt' });
  });
});

describe('extractArchive', () => {
  it('zip: files and folders, bad paths skipped', async () => {
    const z = zipSync({ 'a.txt': enc.encode('A'), 'dir/': new Uint8Array(0), 'dir/b.txt': enc.encode('B'.repeat(3000)), '../evil.txt': enc.encode('x') });
    const r = await run(z, 'zip');
    expect(r.files).toEqual({ 'a.txt': 'A', 'dir/b.txt': 'B'.repeat(3000) });
    expect(r.count).toBe(2);
    expect(r.skipped).toEqual([{ path: '../evil.txt', reason: 'chemin hors du dossier' }]);
    expect(r.partial).toBe(false);
  });

  it('zip made by the zip command (data descriptors, deflate)', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'src', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'src', 'x.md'), '# X\n'.repeat(200));
    writeFileSync(join(dir, 'src', 'sub', 'y.txt'), 'y');
    execFileSync('zip', ['-qr', '-fd', join(dir, 'a.zip'), 'src'], { cwd: dir });
    const r = await run(new Uint8Array(readFileSync(join(dir, 'a.zip'))), 'zip');
    expect(r.files).toEqual({ 'src/x.md': '# X\n'.repeat(200), 'src/sub/y.txt': 'y' });
  });

  it('zip: sizes from the central directory refused before any write', async () => {
    const big = zipSync({ 'a.txt': enc.encode('a'), 'b.bin': new Uint8Array(6000) });
    await expect(run(big, 'zip')).rejects.toMatchObject({ code: 'too_big' });
    const many = zipSync(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, enc.encode('x')])));
    await expect(run(many, 'zip', { ...LIMITS, maxEntries: 4 })).rejects.toMatchObject({ code: 'too_big' });
    await expect(run(enc.encode('pas une archive'), 'zip')).rejects.toBeInstanceOf(ArchiveError);
  });

  it('tar: plain files, folders, links and special files skipped', async () => {
    const t = tar([['d', null], ['d/a.txt', 'A'], ['lien', '', '2'], ['../x', 'x'], ['fifo', '', '6'], ['e.txt', '']]);
    const r = await run(t, 'tar');
    expect(r.files).toEqual({ 'd/a.txt': 'A', 'e.txt': '' });
    expect(r.skipped.map((s) => s.reason)).toEqual(['lien symbolique', 'chemin hors du dossier', 'fichier spécial']);
  });

  it('tar made by the tar command, long names (GNU and pax), gzip', async () => {
    const dir = tempDir();
    const long = `${'n'.repeat(120)}.txt`;
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', long), 'long');
    writeFileSync(join(dir, 'src', 'b.txt'), 'B'.repeat(1500));
    for (const format of ['gnu', 'pax']) {
      execFileSync('tar', [`--format=${format}`, '-cf', join(dir, `${format}.tar`), 'src'], { cwd: dir });
      const bytes = new Uint8Array(readFileSync(join(dir, `${format}.tar`)));
      expect((await run(bytes, 'tar')).files).toEqual({ [`src/${long}`]: 'long', 'src/b.txt': 'B'.repeat(1500) });
      expect((await run(gzipSync(bytes), 'tgz')).files).toEqual({ [`src/${long}`]: 'long', 'src/b.txt': 'B'.repeat(1500) });
    }
  });

  it('tar: sizes in the headers refused before any write; tgz stopped while writing → partial', async () => {
    const t = tar([['a.txt', 'a'], ['b.txt', 'b'.repeat(6000)]]);
    const written: string[] = [];
    await expect(extractArchive(t, 'tar', LIMITS, async (p) => { written.push(p); return 'written'; })).rejects.toMatchObject({ code: 'too_big' });
    expect(written).toEqual([]);
    const r = await run(gzipSync(t), 'tgz');
    expect(r.files).toEqual({ 'a.txt': 'a' });
    expect(r.partial).toBe(true);
    const total = tar([['a', 'a'.repeat(4000)], ['b', 'b'.repeat(4000)], ['c', 'c'.repeat(4000)]]);
    expect((await run(gzipSync(total), 'tgz')).partial).toBe(true);
    await expect(run(gzipSync(tar([['a', 'a'.repeat(6000)]])), 'tgz')).rejects.toMatchObject({ code: 'too_big' });
  });

  it('cut or broken archives are invalid; a stop asked stops at the next file', async () => {
    const t = tar([['a.txt', 'a'.repeat(1000)]]);
    await expect(run(t.subarray(0, 700), 'tar')).rejects.toMatchObject({ code: 'invalid' });
    await expect(run(enc.encode('x'.repeat(600)), 'tar')).rejects.toMatchObject({ code: 'invalid' });
    await expect(run(enc.encode('pas du gzip'), 'tgz')).rejects.toMatchObject({ code: 'invalid' });
    let calls = 0;
    const r = await run(tar([['a', 'a'], ['b', 'b']]), 'tar', LIMITS, () => ++calls > 1);
    expect(r).toMatchObject({ count: 1, partial: true });
  });
});
