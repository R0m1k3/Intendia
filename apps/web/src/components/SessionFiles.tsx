import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, Copy, FolderOpen, X } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, type FileEntry, type ShareLink } from '../api';
import { DropZone } from '../files/DropZone';
import { FileRows } from '../files/FileRows';
import { baseName } from '../files/paths';
import { absoluteUrl } from '../files/Preview';
import { copyText, cx } from './ui';
import { workspaceScope } from '../files/scope';

/** Links made by share_file (or the preview) for a file of this session's folder. */
export function sessionLinks(links: ShareLink[], inst: string, slug: string, sessionId: string): ShareLink[] {
  const dir = `${slug}/sessions/${sessionId}/`;
  return links.filter((l) => l.instanceId === inst && !l.revoked && l.path.startsWith(dir));
}

function SharedRow({ l }: { l: ShareLink }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex h-12 min-w-0 items-center gap-2 px-4">
      <span className="min-w-0 flex-1 truncate text-sm" title={l.path}>{baseName(l.path)}</span>
      {!l.exists && <span className="shrink-0 text-[11px] text-ink-faint">fichier absent</span>}
      <button
        type="button" title="Copier le lien" aria-label={`Copier le lien de ${baseName(l.path)}`}
        onClick={() => void copyText(absoluteUrl(l.url), 'Lien').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink"
      >
        {copied ? <Check className="size-4" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.5} />}
      </button>
    </li>
  );
}

/**
 * "Fichiers de la session": the session folder read from the disk, then the other existing files
 * cited in the thread. Reloaded at the end of each run (runKey).
 */
export function SessionFiles({ inst, slug, sessionId, cited, onOpen, onClose, onDrop, runKey }: {
  inst: string;
  slug: string;
  sessionId: string;
  /** Files dropped on the panel's footer: same as on the page (inbox/ + cited in the message). */
  onDrop: (files: File[]) => void;
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
  const [tab, setTab] = useState<'files' | 'shared'>('files');
  const links = useQuery({ queryKey: ['links'], queryFn: api.links, enabled: tab === 'shared' });
  const shared = sessionLinks(links.data?.links ?? [], inst, slug, sessionId);
  const own = tree.data?.entries ?? [];
  const elsewhere: FileEntry[] = cited
    .filter((p) => !p.startsWith(`${dir}/`))
    .map((p) => ({ name: baseName(p), path: p, kind: 'file' as const, size: 0, mtime: 0 }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <h2 className="sr-only">Fichiers de la session</h2>
        <div role="tablist" aria-label="Fichiers de la session" className="flex flex-1 gap-0.5">
          {([['files', 'Fichiers'], ['shared', 'Partagés']] as const).map(([k, label]) => (
            <button
              key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cx('h-8 rounded-lg px-3 text-[13px] font-medium transition-colors', tab === k ? 'bg-raised text-ink' : 'text-ink-soft hover:text-ink')}
            >
              {label}
            </button>
          ))}
        </div>
        <Link to="/w/$slug/fichiers" params={{ slug }} search={{ path: dir }} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" title="Ouvrir dans l’explorateur" aria-label="Ouvrir dans l’explorateur">
          <FolderOpen className="size-4" strokeWidth={1.5} />
        </Link>
        {onClose && (
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" aria-label="Fermer" title="Fermer">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        )}
      </header>
      {tab === 'shared' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shared.length ? (
            <ul className="divide-y divide-line">{shared.map((l) => <SharedRow key={l.token} l={l} />)}</ul>
          ) : links.isSuccess ? (
            <p className="px-4 py-3 text-sm text-ink-soft">Aucun lien partagé pour un fichier de cette session</p>
          ) : null}
          <Link to="/files" search={{ tab: 'liens' }} className="block px-4 py-3 text-xs text-ink-soft hover:text-ink">Tous les liens</Link>
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-4 pb-1 pt-3 font-mono text-[11px] text-ink-faint">{dir}/</p>
        {own.length ? (
          <FileRows scope={workspaceScope(slug)} entries={own} onOpen={(e) => (e.kind === 'dir' || e.target === 'dir' ? undefined : onOpen(e.path))} />
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
      )}
      <DropZone onFiles={onDrop} label="Déposer dans inbox/ et joindre au message" className="m-3 shrink-0">
        <p className="rounded-xl border border-dashed border-line px-4 py-4 text-center text-xs text-ink-faint">
          Glissez un fichier ici pour le joindre à la session
        </p>
      </DropZone>
    </div>
  );
}
