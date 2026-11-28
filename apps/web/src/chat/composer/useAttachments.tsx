// The composer's attachments: files added (paperclip, paste, drop zones) uploaded one by one into inbox/, archives
// unpacked next to them, a long paste made into a .txt file, their tiles, and the object URLs freed when they go.
import { FileText, FolderArchive, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type RefObject } from 'react';
import { cx } from '../../components/ui';
import { plural, t } from '../../i18n';
import type { ExtractArchive, Upload } from '../Composer';

/** A pasted text longer than this becomes a .txt attachment. */
export const LONG_PASTE = 4000;
export const isArchive = (name: string) => /.\.(zip|tar|tgz|tar\.gz)$/i.test(name);

export interface Attachment {
  id: number;
  name: string;
  image: boolean;
  /** Local preview (object URL) while uploading, then the uploaded file's URL. */
  preview: string | null;
  agentPath: string | null;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  /** under the name: « Décompression… », « 12 fichiers dans inbox/x/ », why the archive stayed packed */
  note?: string;
  /** files left out of the archive with their reason, shown on hover */
  detail?: string;
  /** note from the server sent to the agent before the paths (never translated: it goes to Hermes) */
  agentNote?: string;
}

let nextId = 1;

export function useAttachments({ upload, extract, disabled, onAttachmentsChange, textarea: ref }: {
  upload?: Upload;
  extract?: ExtractArchive;
  disabled?: boolean;
  onAttachmentsChange?: (count: number) => void;
  /** the message field (focused when files are added) */
  textarea: RefObject<HTMLTextAreaElement | null>;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  // a long paste made into a file: « Remettre en texte » until the next send
  const [pastedText, setPastedText] = useState<{ id: number; text: string } | null>(null);
  // object URLs still alive, freed when the tile goes, the upload ends or the composer unmounts
  const blobs = useRef(new Set<string>());
  const free = (url: string | null) => { if (url && blobs.current.delete(url)) URL.revokeObjectURL(url); };
  useEffect(() => () => { for (const u of blobs.current) URL.revokeObjectURL(u); blobs.current.clear(); }, []);
  useEffect(() => { onAttachmentsChange?.(files.length); }, [files.length, onAttachmentsChange]);

  const patch = (id: number, p: Partial<Attachment>) => setFiles((list) => list.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const addFiles = (added: File[]): number[] => {
    if (!upload || disabled || !added.length) return [];
    const tiles = added.map((f) => {
      const image = f.type.startsWith('image/');
      const preview = image ? URL.createObjectURL(f) : null;
      if (preview) blobs.current.add(preview);
      return { file: f, tile: { id: nextId++, name: f.name, image, preview, agentPath: null, state: 'pending' as const } };
    });
    setFiles((list) => [...list, ...tiles.map((str) => str.tile)]);
    ref.current?.focus();
    void (async () => {
      for (const { file, tile } of tiles) {
        try {
          const done = await upload(file);
          free(tile.preview);
          const preview = tile.image ? done.url : null;
          if (extract && isArchive(file.name)) {
            patch(tile.id, { preview, note: t('Décompression…') });
            patch(tile.id, await unpack(done, extract));
          } else {
            patch(tile.id, { state: 'done', agentPath: done.agentPath, preview });
          }
        } catch (err) {
          patch(tile.id, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return tiles.map((str) => str.tile.id);
  };
  const remove = (a: Attachment) => {
    free(a.preview);
    setFiles((list) => list.filter((x) => x.id !== a.id));
    if (pastedText?.id === a.id) setPastedText(null);
  };

  const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!upload || disabled) return;
    const pasted = Array.from(e.clipboardData.files);
    if (!pasted.length) {
      const str = e.clipboardData.getData('text/plain');
      if (str.length <= LONG_PASTE) return;
      e.preventDefault();
      const [id] = addFiles([new File([str], pastedTextName(), { type: 'text/plain' })]);
      if (id !== undefined) setPastedText({ id, text: str });
      return;
    }
    e.preventDefault();
    addFiles(pasted.map((f, i) => new File([f], pastedName(f, i, pasted.length), { type: f.type })));
  };

  return { files, setFiles, free, addFiles, remove, paste, pastedText, setPastedText };
}

export function Tile({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const failed = a.state === 'failed';
  return (
    <li
      data-attachment={a.state} title={failed ? t('Échec : {error}', { error: a.error ?? '' }) : a.detail ? `${a.name}\n${a.detail}` : a.name}
      className={cx('group relative', a.image ? 'size-16' : 'flex h-16 max-w-[14rem] items-center')}
    >
      {a.image && a.preview ? (
        <img src={a.preview} alt={a.name} className={cx('size-16 rounded-lg border object-cover', failed ? 'border-bad' : 'border-line')} />
      ) : (
        <span className={cx('file-chip h-9', failed && '!border-bad')}>
          {a.note ? <FolderArchive className="size-3.5 shrink-0" strokeWidth={1.5} /> : <FileText className="size-3.5 shrink-0" strokeWidth={1.5} />}
          <span className="min-w-0">
            <span className="block truncate">{a.name}</span>
            {a.note && <span data-archive-note className="block truncate text-[11px] text-ink-faint">{a.note}</span>}
          </span>
        </span>
      )}
      {a.state === 'pending' && (
        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-sheet/60" role="img" aria-label={t('Envoi…|fichier')}>
          <Loader2 className="size-4 animate-spin text-ink-soft" strokeWidth={1.75} />
        </span>
      )}
      <button
        type="button" onClick={onRemove} aria-label={t('Retirer {name}', { name: a.name })} title={t('Retirer {name}', { name: a.name })}
        className="tap-area absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-line bg-sheet text-ink-soft shadow-sm hover:text-ink"
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </li>
  );
}

/** After the upload of an archive: the tile points at the folder made from it, or stays the archive (with why). */
async function unpack(done: { agentPath: string; path: string }, extract: ExtractArchive): Promise<Partial<Attachment>> {
  try {
    const r = await extract(done.path);
    const agentPath = done.agentPath.slice(0, done.agentPath.length - done.path.length) + r.folder;
    const n = plural(r.count, '{n} fichier', '{n} fichiers');
    const extra = [r.skipped.length ? t('{n} ignorés', { n: r.skipped.length }) : '', r.partial ? t('incomplet') : ''].filter(Boolean).join(', ');
    const detail = r.skipped.length ? skippedLines(r.skipped) : undefined;
    return { state: 'done', agentPath, detail, agentNote: r.agentNote ?? undefined, note: extra ? t('{files} dans {folder}/ ({extra})', { files: n, folder: r.folder, extra }) : t('{files} dans {folder}/', { files: n, folder: r.folder }) };
  } catch (err) {
    return { state: 'done', agentPath: done.agentPath, note: t('Non décompressée : {error}', { error: err instanceof Error ? err.message : String(err) }) };
  }
}

const SKIPPED_SHOWN = 10;

/** « big.bin : plus de 32 Mo, non décompressé », one line per file left out (reasons come translated by the server). */
function skippedLines(skipped: { path: string; reason: string }[]): string {
  const lines = skipped.slice(0, SKIPPED_SHOWN).map((s) => t('{path} : {reason}', { path: s.path, reason: s.reason }));
  if (skipped.length > SKIPPED_SHOWN) lines.push(t('… et {n} autres', { n: skipped.length - SKIPPED_SHOWN }));
  return lines.join('\n');
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** collage-2026-11-12-143205.txt */
export const pastedTextName = () => `collage-${stamp()}.txt`;

/** collage-2026-11-10-143205.png (-2, -3… when several files come in one paste); keeps real file names. */
function pastedName(f: File, i: number, count: number): string {
  if (f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f.name;
  const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
  return `collage-${stamp()}${count > 1 ? `-${i + 1}` : ''}.${ext}`;
}
