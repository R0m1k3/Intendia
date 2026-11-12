import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronRight, Search, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type FileEntry } from '../api';
import { PageHeader } from '../components/Layout';
import { Button, cx, ErrorText, Input, Panel } from '../components/ui';
import { DropZone } from '../files/DropZone';
import { FileRows, isDirEntry } from '../files/FileRows';
import { Preview } from '../files/Preview';
import { uploadFiles } from '../files/upload';
import { workspaceScope } from '../files/scope';

export interface FilesSearch {
  path?: string;
  f?: string;
}

export function FilesPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const search = useSearch({ strict: false }) as FilesSearch;
  const dir = search.path ?? '';
  const open = search.f ?? null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const tree = useQuery({ queryKey: ['tree', slug, dir], queryFn: () => api.tree(slug, dir) });
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const instLabel = instances.data?.instances.find((i) => i.id === ws.data?.workspace.instanceId)?.label ?? ws.data?.workspace.instanceId;
  // the workspace folder itself is missing on its Hermes (made in another volume before 0.0.4, or deleted by the agent)
  const treeError = !dir && tree.error instanceof ApiError && tree.error.status === 404
    ? new Error(`Dossier introuvable chez ${instLabel ?? 'Hermes'} : copiez-le dans la racine des workspaces de cette instance, ou supprimez ce workspace.`)
    : tree.error;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const found = useQuery({ queryKey: ['file-search', slug, debounced], queryFn: () => api.searchFiles(slug, debounced), enabled: debounced.length > 0 });
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const go = (s: FilesSearch) => navigate({ to: '/w/$slug/fichiers', params: { slug }, search: s });
  const onOpen = (e: FileEntry) => {
    if (isDirEntry(e)) {
      setQ('');
      void go({ path: e.path });
    } else void go({ path: e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '', f: e.path });
  };

  // Uploads go to the open folder; at the root, to inbox/.
  const target = dir || 'inbox';
  const upload = async (files: File[]) => {
    setUploading(true);
    setError(null);
    try {
      await uploadFiles(slug, target, files);
      await qc.invalidateQueries({ queryKey: ['tree', slug] });
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  };

  const crumbs = dir ? dir.split('/') : [];
  const entries = debounced ? found.data?.results ?? [] : tree.data?.entries ?? [];

  return (
    <div>
      <PageHeader
        eyebrow={<Link to="/w/$slug" params={{ slug }} className="hover:text-ink">{ws.data?.workspace.name ?? slug}</Link>}
        title="Fichiers"
        subtitle="Le dossier du workspace, partagé avec l’agent"
        action={
          <div className="flex items-center gap-2">
            <input ref={input} type="file" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void upload(f); }} />
            <Button variant="primary" onClick={() => input.current?.click()} disabled={uploading}>
              <Upload className="size-4" strokeWidth={1.5} />{uploading ? 'Envoi…' : 'Déposer'}
            </Button>
          </div>
        }
      />
      <div className={cx('grid gap-5 px-4 pb-14 md:px-8', open ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]' : 'max-w-[1000px]')}>
        <DropZone onFiles={(f) => void upload(f)} label={`Déposer dans ${target}/`} className="min-w-0">
          <Panel
            className="overflow-hidden"
            bodyClassName="border-t border-line/70"
            title={
              <nav aria-label="Dossier" className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[13px] font-normal">
                <Link to="/w/$slug" params={{ slug }} className="text-ink-faint hover:text-ink">{slug}</Link>
                <ChevronRight className="size-3.5 text-ink-faint" strokeWidth={1.5} />
                <button onClick={() => void go({})} className={cx(crumbs.length ? 'text-ink-faint hover:text-ink' : 'text-ink')}>fichiers</button>
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight className="size-3.5 text-ink-faint" strokeWidth={1.5} />
                    <button onClick={() => void go({ path: crumbs.slice(0, i + 1).join('/') })} className={i === crumbs.length - 1 ? 'text-ink' : 'text-ink-faint hover:text-ink'}>{c}</button>
                  </span>
                ))}
              </nav>
            }
            action={
              <div className="relative w-40 shrink-0 sm:w-48">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un nom" className="h-9 pl-8" aria-label="Chercher un fichier" />
                {q && (
                  <button onClick={() => setQ('')} className="absolute right-2 top-2.5 text-ink-faint hover:text-ink" aria-label="Effacer"><X className="size-4" strokeWidth={1.5} /></button>
                )}
              </div>
            }
          >
            <div className="px-4 pt-3 empty:hidden"><ErrorText error={error ?? treeError} /></div>
            {debounced && <p className="px-4 pb-2 pt-2 text-xs text-ink-faint">{found.isFetching ? 'Recherche…' : `${entries.length} résultat${entries.length > 1 ? 's' : ''} dans tout le workspace${found.data?.truncated ? ' (liste coupée)' : ''}`}</p>}
            {entries.length > 0 ? (
              <FileRows scope={workspaceScope(slug)} entries={entries} selected={open} onOpen={onOpen} actions onError={setError} />
            ) : (tree.isSuccess && !debounced) ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-medium">Aucun fichier ici</p>
                <p className="mt-1 text-sm text-ink-faint">Glissez-en un dans cette zone, ou utilisez Déposer</p>
              </div>
            ) : null}
            {tree.data?.truncated && !debounced && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">Dossier coupé à 2 000 éléments : utilisez la recherche</p>}
          </Panel>
        </DropZone>
        {open && (
          <section className="fixed inset-0 z-30 bg-sheet lg:sticky lg:top-6 lg:z-auto lg:h-[calc(var(--content-h)-3rem)] lg:overflow-hidden lg:rounded-xl lg:border lg:border-line">
            <Preview scope={workspaceScope(slug)} path={open} onClose={() => void go({ path: dir || undefined })} />
          </section>
        )}
      </div>
    </div>
  );
}
