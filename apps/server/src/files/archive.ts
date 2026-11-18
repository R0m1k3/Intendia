// Archives joined in the chat (.zip, .tar, .tar.gz, .tgz), unpacked by Intendia so the agent can read the files
// without a tool of its own. Entries come out one by one and are written between two pushes of the archive, so only
// a few files are in memory at once. Paths leaving the folder, links and special files are skipped, never written;
// so is a file bigger than `maxFile` (listed in `skipped`), while the entry count and the total stop the extraction.
import { Gunzip, Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from 'fflate';
import { checkName } from './paths.js';
import { msg } from '../i18n/index.js';

export type ArchiveKind = 'zip' | 'tar' | 'tgz';

export class ArchiveError extends Error {
  constructor(readonly code: 'invalid' | 'too_big' | 'busy', message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export const ARCHIVE_STATUS = { invalid: 400, too_big: 413, busy: 409 } as const;
export const ARCHIVE_CODE = { invalid: 'invalid_archive', too_big: 'too_big', busy: 'busy' } as const;

export interface ArchiveLimits {
  maxEntries: number;
  /** all files together, decompressed */
  maxTotal: number;
  /** one file, decompressed: a bigger one is skipped (it would be held whole in memory) */
  maxFile: number;
}

/** Largest file unpacked from an archive (less when the upload limit is lower). */
export const EXTRACT_FILE_MAX = 32 * 1024 * 1024;

export interface Skipped {
  path: string;
  reason: string;
}

const EXTENSIONS: [string, ArchiveKind][] = [['.tar.gz', 'tgz'], ['.tgz', 'tgz'], ['.tar', 'tar'], ['.zip', 'zip']];

export function archiveKind(name: string): ArchiveKind | null {
  const n = name.toLowerCase();
  return EXTENSIONS.find(([ext]) => n.endsWith(ext) && n.length > ext.length)?.[1] ?? null;
}

/** "Rapport.tar.gz" → "Rapport". */
export function archiveStem(name: string): string {
  const n = name.toLowerCase();
  const ext = EXTENSIONS.find(([e]) => n.endsWith(e))?.[0];
  return ext ? name.slice(0, -ext.length) : name;
}

/** Path inside the folder, or the reason to skip it. Backslashes of Windows archives are separators. */
export function safePath(raw: string): { path: string } | { reason: string } {
  const parts = raw.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[a-zA-Z]:/.test(raw) || parts.includes('..')) {
    return { reason: msg('chemin hors du dossier') };
  }
  if (!parts.length) return { reason: msg('nom vide') };
  try {
    for (const p of parts) checkName(p);
  } catch {
    return { reason: msg('nom invalide') };
  }
  return { path: parts.join('/') };
}

const CHUNK = 16 * 1024;
const tooBig = (what: string) => new ArchiveError('too_big', what);
const tooLarge = (limits: ArchiveLimits) => msg('plus de {n} Mo, non décompressé', { n: Math.floor(limits.maxFile / 1048576) });

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

interface Ready {
  path: string;
  data: Uint8Array;
}

/**
 * Writes every file of the archive through `write` (awaited, one at a time). A file bigger than `maxFile` (announced
 * or real) is skipped and listed. The entry count and the total are checked before the first write when the archive
 * gives them (zip, tar); a real total beyond the limit stops the extraction: `partial` when files were written
 * already, `too_big` otherwise. `stop()` true → stop at the next file, `partial`.
 */
export async function extractArchive(
  bytes: Uint8Array,
  kind: ArchiveKind,
  limits: ArchiveLimits,
  write: (path: string, data: Uint8Array) => Promise<'written' | Skipped>,
  stop: () => boolean = () => false,
): Promise<{ count: number; skipped: Skipped[]; partial: boolean }> {
  const skipped: Skipped[] = [];
  const big = kind === 'zip' ? precheckZip(bytes, limits) : new Map<string, boolean[]>();
  if (kind === 'tar') precheckTar(bytes, limits);

  let count = 0;
  let total = 0;
  let entries = 0;
  let partial = false;
  const queue: Ready[] = [];
  const reader = kind === 'zip' ? zipReader(queue, skipped, limits, big) : tarReader(kind, queue, skipped, limits);

  const drain = async () => {
    while (queue.length) {
      const f = queue.shift()!;
      entries += 1;
      total += f.data.length;
      if (entries > limits.maxEntries) throw tooBig(msg("Plus de {max} fichiers dans l'archive", { max: limits.maxEntries }));
      if (total > limits.maxTotal) throw tooBig(msg('Archive trop grosse une fois décompressée'));
      if (stop()) throw new StopSignal();
      const r = await write(f.path, f.data);
      if (r === 'written') count += 1;
      else skipped.push(r);
    }
  };

  try {
    // files read before a reader error are written first: they are whole and come before it in the archive
    const step = async (fn: () => void) => {
      let failure: unknown = null;
      try { fn(); } catch (err) { failure = err; }
      await drain();
      if (failure) throw failure;
    };
    for (let off = 0; ; off += CHUNK) {
      const final = off + CHUNK >= bytes.length;
      await step(() => reader.push(bytes.subarray(off, off + CHUNK), final));
      if (final) break;
    }
    await step(() => reader.end());
  } catch (err) {
    if (err instanceof StopSignal) partial = true;
    else if (err instanceof ArchiveError && err.code === 'too_big' && count > 0) partial = true;
    else throw err;
  }
  return { count, skipped, partial };
}

class StopSignal extends Error {}

/** Entry count and total announced by the archive (zip: central directory, tar: headers; nothing for tgz), before any write. */
export function precheckArchive(bytes: Uint8Array, kind: ArchiveKind, limits: ArchiveLimits): void {
  if (kind === 'zip') precheckZip(bytes, limits);
  if (kind === 'tar') precheckTar(bytes, limits);
}

interface Reader {
  push(chunk: Uint8Array, final: boolean): void;
  /** after the last push: raises when the archive ended in the middle of an entry */
  end(): void;
}

/** Most skipped files listed one by one in the note for the agent. */
const NOTE_MAX = 10;
const NAME_MAX = 120;

/**
 * A name from the archive is untrusted data going into the agent's message: control characters (line breaks
 * included) and backticks become spaces, it is cut at 120 characters, then put between backticks.
 */
export function cleanName(raw: string): string {
  const flat = raw.replace(/[\p{Cc}`]/gu, ' ');
  const chars = [...flat];
  const cut = chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : flat;
  return `\`${cut}\``;
}

/**
 * Note sent to the agent before the attachment paths when an archive was not unpacked whole; null when everything
 * went through. Always in French: what is sent to Hermes is never translated (the reasons are French inside the server).
 */
export function archiveAgentNote(archiveName: string, skipped: Skipped[], partial: boolean): string | null {
  if (!skipped.length && !partial) return null;
  const lines: string[] = [];
  if (skipped.length) {
    const n = skipped.length;
    lines.push(`[Intendia] Archive ${cleanName(archiveName)} : ${n} ${n === 1 ? 'fichier non décompressé' : 'fichiers non décompressés'}.`);
    for (const s of skipped.slice(0, NOTE_MAX)) lines.push(`- ${cleanName(s.path)} : ${s.reason}`);
    if (n > NOTE_MAX) lines.push(`- … et ${n - NOTE_MAX} ${n - NOTE_MAX === 1 ? 'autre' : 'autres'}`);
  }
  if (partial) lines.push("[Intendia] Décompression incomplète : la limite de l'archive a été atteinte.");
  return lines.join('\n');
}

// --- zip ---------------------------------------------------------------------------------------------------------

/**
 * The central directory gives every size before anything is unpacked. Returns, for each file name, whether each of its
 * occurrences (in central directory order) is announced bigger than `maxFile`: such a file is never started, so neither
 * unpacked nor counted in the total. A zip may hold the same name twice: a small namesake still counts.
 */
function precheckZip(bytes: Uint8Array, limits: ArchiveLimits): Map<string, boolean[]> {
  const infos: UnzipFileInfo[] = [];
  try {
    unzipSync(bytes, { filter: (f) => { infos.push(f); return false; } });
  } catch {
    throw new ArchiveError('invalid', msg('Archive zip illisible'));
  }
  const files = infos.filter((f) => !f.name.endsWith('/'));
  if (files.length > limits.maxEntries) throw tooBig(msg("Plus de {max} fichiers dans l'archive", { max: limits.maxEntries }));
  const big = new Map<string, boolean[]>();
  let total = 0;
  for (const f of files) {
    const tooLargeFile = f.originalSize > limits.maxFile;
    const list = big.get(f.name) ?? [];
    list.push(tooLargeFile);
    big.set(f.name, list);
    if (!tooLargeFile) total += f.originalSize;
  }
  if (total > limits.maxTotal) throw tooBig(msg('Archive trop grosse une fois décompressée'));
  return big;
}

function zipReader(queue: Ready[], skipped: Skipped[], limits: ArchiveLimits, big: Map<string, boolean[]>): Reader {
  let failure: ArchiveError | null = null;
  // every byte unpacked, kept or not: a file dropped past maxFile is still inflated to its end (fflate's
  // UnzipInflate has no real terminate), so it must not make the extraction run without end
  let seen = 0;
  // occurrences of each name met so far, to read the right entry of `big`. This assumes the local headers come in
  // the order of the central directory (true for every common zip writer); otherwise a big file started is cut at
  // maxFile below, or a small namesake is skipped as too big.
  const seenNames = new Map<string, number>();
  const unzip = new Unzip((file) => {
    if (file.name.endsWith('/')) return;
    // counted before any early return, so the indices stay aligned with the central directory
    const nth = seenNames.get(file.name) ?? 0;
    seenNames.set(file.name, nth + 1);
    const safe = safePath(file.name);
    if ('reason' in safe) { skipped.push({ path: file.name, reason: safe.reason }); return; }
    if (file.compression !== 0 && file.compression !== 8) {
      skipped.push({ path: safe.path, reason: msg('compression non prise en charge') });
      return;
    }
    // announced too big (central directory or local header): never started, its data is passed over
    if (big.get(file.name)?.[nth] || (file.originalSize ?? 0) > limits.maxFile) {
      skipped.push({ path: safe.path, reason: tooLarge(limits) });
      return;
    }
  let chunks: Uint8Array[] | null = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) { failure = new ArchiveError('invalid', msg('Archive zip illisible')); return; }
      seen += chunk.length;
      if (seen > limits.maxTotal) { failure = tooBig(msg('Archive trop grosse une fois décompressée')); file.terminate(); return; }
      if (!chunks) return;
      size += chunk.length;
      // the sizes announced may lie: past maxFile the file is dropped, the next ones go on
      if (size > limits.maxFile) {
        chunks = null;
        skipped.push({ path: safe.path, reason: tooLarge(limits) });
        file.terminate();
        return;
      }
      if (chunk.length) chunks.push(chunk);
      if (final) queue.push({ path: safe.path, data: concat(chunks, size) });
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  return {
    push(chunk, final) {
      try {
        unzip.push(chunk, final);
      } catch {
        failure ??= new ArchiveError('invalid', msg('Archive zip illisible'));
      }
      if (failure) throw failure;
    },
    end() {
      if (failure) throw failure;
    },
  };
}

// --- tar -------------------------------------------------------------------------------------------------------------

const BLOCK = 512;
const decoder = new TextDecoder();

function field(b: Uint8Array, off: number, len: number): string {
  const s = b.subarray(off, off + len);
  const z = s.indexOf(0);
  return decoder.decode(z >= 0 ? s.subarray(0, z) : s);
}

/** Octal, or base-256 when the first byte has its high bit (GNU, sizes beyond 8 GB). */
function num(b: Uint8Array, off: number, len: number): number {
  if (b[off]! & 0x80) {
    let n = b[off]! & 0x7f;
    for (let i = off + 1; i < off + len; i++) n = n * 256 + b[i]!;
    return n;
  }
  const s = field(b, off, len).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new ArchiveError('invalid', msg('Archive tar illisible'));
  return parseInt(s, 8);
}

interface Header {
  name: string;
  type: string;
  size: number;
}

/** null = end-of-archive block (all zeros). */
function parseHeader(b: Uint8Array): Header | null {
  if (b.every((x) => x === 0)) return null;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : b[i]!;
  if (sum !== num(b, 148, 8)) throw new ArchiveError('invalid', msg('Archive tar illisible'));
  const name = field(b, 0, 100);
  const prefix = field(b, 257, 6).startsWith('ustar') ? field(b, 345, 155) : '';
  const t = String.fromCharCode(b[156]!);
  return { name: prefix ? `${prefix}/${name}` : name, type: t === '\0' ? '0' : t, size: num(b, 124, 12) };
}

/** GNU long name or pax header: a few hundred bytes in practice. */
const META_MAX = 64 * 1024;
const padOf = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;
const isFile = (type: string) => type === '0' || type === '7';
const KIND_REASON: Record<string, string> = { '1': msg('lien'), '2': msg('lien symbolique'), '3': msg('fichier spécial'), '4': msg('fichier spécial'), '6': msg('fichier spécial') };

/** Sizes from the headers of a .tar already in memory, before anything is written. */
function precheckTar(bytes: Uint8Array, limits: ArchiveLimits): void {
  let files = 0;
  let total = 0;
  for (let off = 0; off + BLOCK <= bytes.length;) {
    const h = parseHeader(bytes.subarray(off, off + BLOCK));
    if (!h) break;
    if (isFile(h.type)) {
      files += 1;
      // a file past maxFile is skipped, but still read through: it counts in the total
      total += h.size;
    }
    off += BLOCK + h.size + padOf(h.size);
  }
  if (files > limits.maxEntries) throw tooBig(msg("Plus de {max} fichiers dans l'archive", { max: limits.maxEntries }));
  if (total > limits.maxTotal) throw tooBig(msg('Archive trop grosse une fois décompressée'));
}

/** Pax extended header: "<len> path=<value>\n" lines; only the path is used. */
function paxPath(data: Uint8Array): string | null {
  const text = decoder.decode(data);
  for (const line of text.split('\n')) {
    const m = /^\d+ path=(.*)$/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/** Streaming tar (fed with the plain bytes, or with what gunzip gives for .tgz). */
function tarReader(kind: 'tar' | 'tgz', queue: Ready[], skipped: Skipped[], limits: ArchiveLimits): Reader {
  let head = new Uint8Array(0);
  // entry being read: its data (kept only for files and the GNU / pax names), then its padding
  let cur: { h: Header; keep: 'file' | 'name' | 'pax' | null; path: string | null; reason: string | null; left: number; chunks: Uint8Array[] } | null = null;
  let pad = 0;
  let ended = false;
  let longName: string | null = null;
  let pax: string | null = null;

  // every payload byte read, kept or not: a skipped entry must not make the reader run without end
  let seen = 0;
  const finish = () => {
    const c = cur!;
    const data = c.keep ? concat(c.chunks, c.h.size) : new Uint8Array(0);
    if (c.keep === 'name') longName = field(data, 0, data.length);
    else if (c.keep === 'pax') pax = paxPath(data);
    else if (c.keep === 'file' && c.path) queue.push({ path: c.path, data });
    pad = padOf(c.h.size);
    cur = null;
  };

  const start = (h: Header) => {
    let keep: 'file' | 'name' | 'pax' | null = null;
    let path: string | null = null;
    let reason: string | null = null;
    if (h.type === 'L' || h.type === 'x') {
      if (h.size > META_MAX) throw new ArchiveError('invalid', msg('En-tête d’archive tar trop long'));
      keep = h.type === 'L' ? 'name' : 'pax';
    }
    else {
      const name = pax ?? longName ?? h.name;
      pax = null;
      longName = null;
      if (isFile(h.type)) {
        const safe = safePath(name);
        if ('reason' in safe) reason = safe.reason;
        else if (h.size > limits.maxFile) reason = tooLarge(limits);
        else { path = safe.path; keep = 'file'; }
      } else if (h.type !== '5' && h.type !== 'g' && h.type !== 'K') {
        reason = KIND_REASON[h.type] ?? msg('type d’entrée non pris en charge');
      }
      if (reason) skipped.push({ path: name, reason });
    }
    cur = { h, keep, path, reason, left: h.size, chunks: [] };
    if (h.size === 0) finish();
  };

  const feed = (chunk: Uint8Array) => {
    let i = 0;
    while (i < chunk.length && !ended) {
      if (cur) {
        const take = Math.min(cur.left, chunk.length - i);
        seen += take;
        if (seen > limits.maxTotal) throw tooBig(msg('Archive trop grosse une fois décompressée'));
        if (cur.keep) cur.chunks.push(chunk.slice(i, i + take));
        cur.left -= take;
        i += take;
        if (cur.left === 0) finish();
      } else if (pad > 0) {
        const take = Math.min(pad, chunk.length - i);
        pad -= take;
        i += take;
      } else {
        const take = Math.min(BLOCK - head.length, chunk.length - i);
        const next = new Uint8Array(head.length + take);
        next.set(head);
        next.set(chunk.subarray(i, i + take), head.length);
        head = next;
        i += take;
        if (head.length === BLOCK) {
          const h = parseHeader(head);
          head = new Uint8Array(0);
          if (!h) ended = true;
          else start(h);
        }
      }
    }
  };

  let failure: ArchiveError | null = null;
  const gunzip = kind === 'tgz' ? new Gunzip((data) => { if (!failure) { try { feed(data); } catch (err) { failure = err instanceof ArchiveError ? err : new ArchiveError('invalid', msg('Archive illisible')); } } }) : null;
  return {
    push(chunk, final) {
      if (gunzip) {
        try {
          gunzip.push(chunk, final);
        } catch {
          failure ??= new ArchiveError('invalid', msg('Archive gzip illisible'));
        }
        if (failure) throw failure;
      } else {
        feed(chunk);
      }
    },
    end() {
      if (failure) throw failure;
      if (cur) throw new ArchiveError('invalid', msg('Archive tar coupée'));
    },
  };
}
