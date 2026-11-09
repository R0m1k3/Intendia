import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FolderOpen, X } from 'lucide-react';
import { api, ApiError, type FileEntry } from '../api';
import { FileRows } from '../files/FileRows';
import { baseName } from '../files/paths';

/**
 * "Fichiers de la session": the session folder read from the disk, then the other existing files
 * cited in the thread. Reloaded at the end of each run (runKey).
 */
export function SessionFiles({ slug, sessionId, cited, onOpen, onClose, runKey }: {
  slug: string;
  sessionId: string;
  /** Workspace-relative paths of files cited in the thread. */
  cited: string[];
  onOpen: (path: string) => void;
  onClose?: () => void;
  runKey: unknown;
}) {
  const dir = `sessions/${sessionId}`;
  const tree = useQuery({
    queryKey: ['tree', slug, dir, runKey],
    queryFn: () => api.tree(slug, dir).catch((err) => {
      if (err instanceof ApiError && err.status === 404) return { path: dir, entries: [], truncated: false };
      throw err;
    }),
  });
  const own = tree.data?.entries ?? [];
  const elsewhere: FileEntry[] = cited
    .filter((p) => !p.startsWith(`${dir}/`))
    .map((p) => ({ name: baseName(p), path: p, kind: 'file' as const, size: 0, mtime: 0 }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="flex-1 text-sm font-medium">Fichiers de la session</h2>
        <Link to="/w/$slug/fichiers" params={{ slug }} search={{ path: dir }} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" title="Ouvrir dans l’explorateur" aria-label="Ouvrir dans l’explorateur">
          <FolderOpen className="size-4" strokeWidth={1.5} />
        </Link>
        {onClose && (
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" aria-label="Fermer" title="Fermer">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 pb-1 pt-3 font-mono text-[11px] text-ink-faint">{dir}/</p>
        {own.length ? (
          <FileRows slug={slug} entries={own} onOpen={(e) => (e.kind === 'dir' || e.target === 'dir' ? undefined : onOpen(e.path))} />
        ) : tree.isSuccess ? (
          <p className="px-4 py-3 text-sm text-ink-soft">Aucun fichier pour l’instant</p>
        ) : null}
        {elsewhere.length > 0 && (
          <>
            <p className="px-4 pb-1 pt-5 text-[11px] text-ink-faint">Cités dans le fil</p>
            <ul className="divide-y divide-line">
              {elsewhere.map((e) => (
                <li key={e.path}>
                  <button onClick={() => onOpen(e.path)} className="flex h-11 w-full min-w-0 items-center gap-3 px-4 text-left text-sm hover:bg-raised/50" title={e.path}>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-ink-faint">{e.path.slice(0, -e.name.length - 1)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
