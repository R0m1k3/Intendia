import { gzipSync, zipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveAgentNote, archiveKind, archiveStem, ArchiveError, cleanName, EXTRACT_FILE_MAX, extractArchive, safePath, type ArchiveKind } from '../src/files/archive.js';
import { tempDir } from './helpers.js';
import { toLang } from '../src/i18n/index.js';

const enc = new TextEncoder();
const LIMITS = { maxEntries: 100, maxTotal: 10_000, maxFile: 5_000 };

/** A ustar archive by hand: entries [name, data | null (folder), type]. */
function tar(entries: [string, string | Uint8Array | null, string?][]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, data, type] of entries) {
    const h = new Uint8Array(512);
    const body = data === null ? new Uint8Array(0) : typeof data === 'string' ? enc.encode(data) : data;
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

/** zipSync output with every `from` name (local header and central directory) renamed `to`, same length. */
function renamed(zip: Uint8Array, from: string, to: string): Uint8Array {
  const a = enc.encode(from);
  const b = enc.encode(to);
  const out = new Uint8Array(zip);
  let n = 0;
  for (let i = 0; i + a.length <= out.length; i++) {
    if (a.every((x, j) => out[i + j] === x)) { out.set(b, i); n += 1; }
  }
  expect(n).toBe(2);
  return out;
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

  it('zip: a file announced too big is skipped; count and total refused before any write', async () => {
    const big = zipSync({ 'a.txt': enc.encode('a'), 'b.bin': new Uint8Array(6000) });
    expect(await run(big, 'zip')).toMatchObject({ files: { 'a.txt': 'a' }, count: 1, partial: false, skipped: [{ path: 'b.bin', reason: 'plus de 0 Mo, non décompressé' }] });
    const total = zipSync({ a: new Uint8Array(4000), b: new Uint8Array(4000), c: new Uint8Array(4000) });
    const written: string[] = [];
    await expect(extractArchive(total, 'zip', LIMITS, async (p) => { written.push(p); return 'written'; })).rejects.toMatchObject({ code: 'too_big' });
    expect(written).toEqual([]);
    const many = zipSync(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, enc.encode('x')])));
    await expect(run(many, 'zip', { ...LIMITS, maxEntries: 4 })).rejects.toMatchObject({ code: 'too_big' });
    await expect(run(enc.encode('pas une archive'), 'zip')).rejects.toBeInstanceOf(ArchiveError);
  });

  it('zip: two entries of the same name, one too big → the small one written, in both orders', async () => {
    const small = enc.encode('petit');
    for (const entries of [{ 'a.bin': small, 'b.bin': new Uint8Array(6000) }, { 'b.bin': new Uint8Array(6000), 'a.bin': small }]) {
      const zip = renamed(zipSync(entries, { level: 0 }), 'b.bin', 'a.bin');
      const written: [string, string][] = [];
      const res = await extractArchive(zip, 'zip', LIMITS, async (p, d) => { written.push([p, new TextDecoder().decode(d)]); return 'written'; });
      expect(written).toEqual([['a.bin', 'petit']]);
      expect(res).toMatchObject({ count: 1, partial: false, skipped: [{ path: 'a.bin', reason: 'plus de 0 Mo, non décompressé' }] });
    }
    // the small namesake counts in the total announced: 3000 + 4500 + 4500 > 10000
    const counted = renamed(zipSync({ 'a.bin': new Uint8Array(3000), 'b.bin': new Uint8Array(6000), c: new Uint8Array(4500), d: new Uint8Array(4500) }, { level: 0 }), 'b.bin', 'a.bin');
    await expect(run(counted, 'zip')).rejects.toMatchObject({ code: 'too_big' });
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

  it('tar: a file bigger than maxFile is skipped (tar and tgz); tgz past the total while writing → partial', async () => {
    const t = tar([['a.txt', 'a'], ['b.txt', 'b'.repeat(6000)], ['c.txt', 'c']]);
    const skipped = [{ path: 'b.txt', reason: 'plus de 0 Mo, non décompressé' }];
    expect(await run(t, 'tar')).toMatchObject({ files: { 'a.txt': 'a', 'c.txt': 'c' }, skipped, partial: false });
    expect(await run(gzipSync(t), 'tgz')).toMatchObject({ files: { 'a.txt': 'a', 'c.txt': 'c' }, skipped, partial: false });
    const total = tar([['a', 'a'.repeat(4000)], ['b', 'b'.repeat(4000)], ['c', 'c'.repeat(4000)]]);
    expect((await run(gzipSync(total), 'tgz')).partial).toBe(true);
    expect(await run(gzipSync(tar([['a', 'a'.repeat(6000)]])), 'tgz')).toMatchObject({ count: 0, skipped: [{ path: 'a' }] });
  });

  it('tar: totals checked before any write; skipped or metadata entries bounded', async () => {
    const many = tar([['a', 'a'.repeat(4000)], ['b', 'b'.repeat(4000)], ['c', 'c'.repeat(4000)]]);
    const written: string[] = [];
    await expect(extractArchive(many, 'tar', LIMITS, async (p) => { written.push(p); return 'written'; })).rejects.toMatchObject({ code: 'too_big' });
    await expect(extractArchive(tar([['a', 'a'], ['b', 'b']]), 'tar', { ...LIMITS, maxEntries: 1 }, async (p) => { written.push(p); return 'written'; })).rejects.toMatchObject({ code: 'too_big' });
    expect(written).toEqual([]);
    // a special file with a big payload is read through, never kept, and counts in the total
    await expect(run(gzipSync(tar([['fifo', 'x'.repeat(12_000), '6']])), 'tgz')).rejects.toMatchObject({ code: 'too_big' });
    expect((await run(gzipSync(tar([['fifo', 'x'.repeat(3000), '6'], ['a', 'a']])), 'tgz')).files).toEqual({ a: 'a' });
    await expect(run(gzipSync(tar([['././@LongLink', 'n'.repeat(70 * 1024), 'L'], ['a', 'a']])), 'tgz', { ...LIMITS, maxTotal: 1e6 })).rejects.toMatchObject({ code: 'invalid' });
  });

  describe('real sizes (EXTRACT_FILE_MAX)', () => {
    const MiB = 1024 * 1024;
    const REAL = { maxEntries: 100, maxTotal: 100 * MiB, maxFile: EXTRACT_FILE_MAX };
    const reason = 'plus de 32 Mo, non décompressé';
    // one buffer of zeros for every big entry: fast to deflate, 40 MiB in memory once
    const zeros = new Uint8Array(40 * MiB);
    /** Sets the uncompressed size announced for `name` in its local header and in the central directory. */
    function announce(zip: Uint8Array, name: string, size: number): void {
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      const needle = enc.encode(name);
      let patched = 0;
      for (let i = 0; i + needle.length <= zip.length; i++) {
        if (zip[i] !== needle[0] || !needle.every((b, k) => zip[i + k] === b)) continue;
        if (i >= 30 && view.getUint32(i - 30, true) === 0x04034b50) { view.setUint32(i - 30 + 22, size, true); patched++; }
        if (i >= 46 && view.getUint32(i - 46, true) === 0x02014b50) { view.setUint32(i - 46 + 24, size, true); patched++; }
      }
      expect(patched).toBe(2);
    }

    it('zip: announced 40 MiB and announced 1 KiB but 40 MiB real are skipped, the small ones written', async () => {
      const zip = zipSync({ 'a.txt': enc.encode('A'), 'gros.bin': zeros, 'menteur.bin': zeros, 'b.txt': enc.encode('B') });
      announce(zip, 'menteur.bin', 1024);
      const r = await run(zip, 'zip', REAL);
      expect(r.files).toEqual({ 'a.txt': 'A', 'b.txt': 'B' });
      expect(r).toMatchObject({ count: 2, partial: false });
      expect(r.skipped).toEqual([{ path: 'gros.bin', reason }, { path: 'menteur.bin', reason }]);
      expect(toLang(reason, 'en')).toBe('over 32 MB, not unpacked');
      // the total still stops: the 40 MiB really unpacked count, kept or not
      const t = await run(zip, 'zip', { ...REAL, maxTotal: 35 * MiB });
      expect(t).toMatchObject({ files: { 'a.txt': 'A' }, partial: true });
    });

    it('tar and tgz: a 40 MiB entry is skipped, the others written', async () => {
      const t = tar([['a.txt', 'A'], ['gros.bin', zeros], ['b.txt', 'B']]);
      for (const [bytes, kind] of [[t, 'tar'], [gzipSync(t, { level: 1 }), 'tgz']] as const) {
        const r = await run(bytes, kind, REAL);
        expect(r.files).toEqual({ 'a.txt': 'A', 'b.txt': 'B' });
        expect(r.skipped).toEqual([{ path: 'gros.bin', reason }]);
      }
      // the total still stops (a skipped entry is read through and counts)
      await expect(run(t, 'tar', { ...REAL, maxTotal: 35 * MiB })).rejects.toMatchObject({ code: 'too_big' });
    });
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

describe('archiveAgentNote', () => {
  const skip = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i + 1}.mov`, reason: 'plus de 32 Mo, non décompressé' }));

  it('nothing skipped and whole → null', () => {
    expect(archiveAgentNote('a.zip', [], false)).toBeNull();
  });

  it('one file: singular', () => {
    expect(archiveAgentNote('photos.zip', skip(1), false)).toBe(
      '[Intendia] Archive `photos.zip` : 1 fichier non décompressé.\n- `f1.mov` : plus de 32 Mo, non décompressé',
    );
  });

  it('12 files and partial: 10 lines, then the rest counted, then the partial line', () => {
    const lines = archiveAgentNote('photos.zip', skip(12), true)!.split('\n');
    expect(lines[0]).toBe('[Intendia] Archive `photos.zip` : 12 fichiers non décompressés.');
    expect(lines.slice(1, 11)).toHaveLength(10);
    expect(lines[10]).toBe('- `f10.mov` : plus de 32 Mo, non décompressé');
    expect(lines[11]).toBe('- … et 2 autres');
    expect(lines[12]).toBe("[Intendia] Décompression incomplète : la limite de l'archive a été atteinte.");
    expect(lines).toHaveLength(13);
  });

  it('partial alone', () => {
    expect(archiveAgentNote('a.zip', [], true)).toBe("[Intendia] Décompression incomplète : la limite de l'archive a été atteinte.");
  });

  it('untrusted names: control characters and backticks removed, cut at 120, between backticks', () => {
    const note = archiveAgentNote('a\nb.zip', [{ path: `x\n\`y\`\r${'z'.repeat(300)}`, reason: 'nom invalide' }], false)!;
    const lines = note.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('`a b.zip`');
    const name = /^- `([^`]*)` : nom invalide$/.exec(lines[1]!)?.[1];
    expect(name).toBeDefined();
    expect([...name!]).toHaveLength(120);
    expect(name!.startsWith('x  y  z')).toBe(true);
    expect(name!.endsWith('…')).toBe(true);
    expect(cleanName('ok.txt')).toBe('`ok.txt`');
  });
});
