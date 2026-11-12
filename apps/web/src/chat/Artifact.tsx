import { FolderOpen, Maximize2 } from 'lucide-react';
import { useRef } from 'react';
import { rawUrl } from '../api';
import { useFilePaths } from '../files/FilePaths';

const LINK = 'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-raised hover:text-ink';

/**
 * A page the agent wrote and named with « ::artefact <path> »: shown in a frame whose scripts run with no origin
 * and no network (the server sends ARTIFACT_CSP only to a frame, for an .html under sessions/). Never in a tab of its
 * own: there, nothing would stop its scripts from navigating to another site (the app's frame-src does, here).
 */
export function Artifact({ path }: { path: string }) {
  const paths = useFilePaths();
  const frame = useRef<HTMLIFrameElement>(null);
  const rel = paths?.found.get(path);
  if (!paths || !rel) {
    return (
      <p className="font-mono text-xs text-ink-faint" data-artifact-missing>
        {paths?.pending ? 'Chargement de l’artefact…' : `Artefact introuvable : ${path}`}
      </p>
    );
  }
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const src = rawUrl(paths.slug, rel, false, true);
  return (
    <figure className="card overflow-hidden" data-artifact>
      <figcaption className="flex items-center gap-1 border-b border-line py-1 pl-3 pr-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">{name}</span>
        <button type="button" className={LINK} onClick={() => void frame.current?.requestFullscreen().catch(() => {})}>
          <Maximize2 className="size-3.5" strokeWidth={1.5} />Plein écran
        </button>
        <button type="button" className={LINK} onClick={() => paths.open(rel)}>
          <FolderOpen className="size-3.5" strokeWidth={1.5} />Voir dans les fichiers
        </button>
      </figcaption>
      <iframe
        ref={frame} src={src} title={name} sandbox="allow-scripts" loading="lazy" referrerPolicy="no-referrer"
        className="block h-[480px] w-full resize-y border-0 bg-white"
      />
    </figure>
  );
}
