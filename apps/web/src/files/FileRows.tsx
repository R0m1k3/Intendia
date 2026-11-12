import { useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCopy, Download, File, FileArchive, FileCode, FileImage, FileText, Folder, FolderSymlink, Link2Off, MessageSquarePlus, MoveRight, Trash2,
  type LucideIcon,
} from 'lucide-react';
import { api, type FileEntry } from '../api';
import { copyText, cx, timeAgo } from '../components/ui';
import { fileKind, formatSize } from './paths';
import { ShareButton } from './Preview';
import type { FileScope } from './scope';
import { ask, askText } from '../components/Dialog';

export const isDirEntry = (e: FileEntry) => e.kind === 'dir' || e.target === 'dir';

function iconOf(e: FileEntry): LucideIcon {
  if (e.outside) return Link2Off;
  if (e.kind === 'link' && e.target === 'dir') return FolderSymlink;
  if (isDirEntry(e)) return Folder;
  const k = fileKind(e.name);
  if (k === 'image' || k === 'svg') return FileImage;
  if (k === 'markdown' || k === 'pdf') return FileText;
  if (k === 'text' || k === 'html') return FileCode;
  return File;
}

const ICON_BTN = 'flex size-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink';

/**
 * One folder's rows. Download (zip for a folder) and « Copier le chemin » (when `agentRoot` is known) everywhere;
 * `actions` adds share, move and delete (explorer of a workspace only); `onInsert` adds « Insérer dans le message ».
 */
export function FileRows({ scope, entries, selected, onOpen, actions = false, onError, onNotice, agentRoot, onInsert }: {
  scope: FileScope;
  entries: FileEntry[];
  selected?: string | null;
  onOpen: (e: FileEntry) => void;
  actions?: boolean;
  onError?: (err: unknown) => void;
  /** A neutral note for the page (folder moved, some files left behind). */
  onNotice?: (text: string) => void;
  /** Absolute root of the listed paths, as the agent sees it. */
  agentRoot?: string;
  /** Session page: puts the file's agent path in the message being written. */
  onInsert?: (agentPath: string) => void;
}) {
  const qc = useQueryClient();
  const slug = scope.workspace;
  const refresh = () => qc.invalidateQueries({ queryKey: [...scope.key] });

  const move = async (e: FileEntry) => {
    const to = await askText({ title: `Renommer ou déplacer ${e.name}`, label: 'Nouveau chemin (relatif au workspace)', value: e.path, confirmLabel: 'Renommer' });
    if (!to || to === e.path || !slug) return;
    if (e.kind === 'dir' && !(await ask({
      title: `Déplacer le dossier ${e.path} et tout son contenu ?`,
      message: 'Évitez pendant qu’une session de ce workspace travaille.', confirmLabel: 'Déplacer',
    }))) return;
    try {
      const res = await api.moveFile(slug, e.path, to);
      if (res.leftover?.length) {
        onNotice?.(`Déplacé. Restent dans ${res.leftover.join(', ')} des fichiers qu’Hermes ne montre pas (clés, configuration) ou ajoutés ou modifiés pendant le déplacement : ils n’ont pas été supprimés.`);
      }
      await refresh();
      void qc.invalidateQueries({ queryKey: ['links'] });
    } catch (err) {
      onError?.(err);
    }
  };
  const remove = async (e: FileEntry) => {
    const what = isDirEntry(e) && e.kind === 'dir' ? `le dossier ${e.path} et tout son contenu` : e.path;
    if (!slug || !(await ask({ title: `Supprimer ${what} ?`, message: 'Cette suppression est définitive.', confirmLabel: 'Supprimer', danger: true }))) return;
    try {
      await api.deleteFile(slug, e.path);
      await refresh();
    } catch (err) {
      onError?.(err);
    }
  };

  return (
    <ul className="divide-y divide-line/70">
      {entries.map((e) => {
        const Icon = iconOf(e);
        return (
          <li key={e.path} className={cx('group flex items-center gap-1 pr-2', selected === e.path && 'bg-accent-soft')}>
            <button
              type="button"
              disabled={e.outside}
              onClick={() => onOpen(e)}
              title={e.outside ? 'Lien symbolique : Intendia ne l’ouvre pas et ne le modifie pas' : e.path}
              className="flex h-11 min-w-0 flex-1 items-center gap-3.5 px-4 text-left transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{e.name}</span>
              <span className="hidden w-20 shrink-0 text-right text-xs text-ink-faint sm:block">{isDirEntry(e) ? '' : formatSize(e.size)}</span>
              <span className="hidden w-24 shrink-0 text-right text-xs text-ink-faint md:block">{timeAgo(e.mtime)}</span>
            </button>
            {!e.outside && e.kind !== 'link' && (
              <div className="flex shrink-0 items-center justify-end opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                {isDirEntry(e) ? (
                  <a href={scope.zip(e.path)} className={ICON_BTN} title="Télécharger (zip)" aria-label={`Télécharger ${e.name} (zip)`}>
                    <FileArchive className="size-4" strokeWidth={1.5} />
                  </a>
                ) : (
                  <a href={scope.raw(e.path, true)} className={ICON_BTN} title="Télécharger" aria-label={`Télécharger ${e.name}`}>
                    <Download className="size-4" strokeWidth={1.5} />
                  </a>
                )}
                {agentRoot && (
                  <button className={ICON_BTN} title="Copier le chemin" aria-label={`Copier le chemin de ${e.name}`}
                    onClick={() => void copyText(`${agentRoot}/${e.path}`, 'Chemin')}>
                    <ClipboardCopy className="size-4" strokeWidth={1.5} />
                  </button>
                )}
                {onInsert && agentRoot && !isDirEntry(e) && (
                  <button className={ICON_BTN} title="Insérer dans le message" aria-label={`Insérer ${e.name} dans le message`}
                    onClick={() => onInsert(`${agentRoot}/${e.path}`)}>
                    <MessageSquarePlus className="size-4" strokeWidth={1.5} />
                  </button>
                )}
                {actions && slug && (
                  <>
                    {!isDirEntry(e) && <ShareButton slug={slug} path={e.path} compact />}
                    <button className={ICON_BTN} title="Renommer ou déplacer" aria-label={`Renommer ou déplacer ${e.name}`} onClick={() => void move(e)}>
                      <MoveRight className="size-4" strokeWidth={1.5} />
                    </button>
                    <button className={cx(ICON_BTN, 'hover:text-bad')} title="Supprimer" aria-label={`Supprimer ${e.name}`} onClick={() => void remove(e)}>
                      <Trash2 className="size-4" strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
