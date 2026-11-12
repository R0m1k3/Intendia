import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Link2, Pencil, Save, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Md } from '../chat/Thread';
import { Button, copyText, cx, ErrorText } from '../components/ui';
import { baseName, fileKind, formatSize } from './paths';
import type { FileScope } from './scope';

const CodeView = lazy(() => import('./CodeView'));
const TEXT_MAX = 1024 * 1024;

/** Absolute URL of a share link (the server gives a path when INTENDIA_PUBLIC_URL is not set). */
export const absoluteUrl = (url: string) => (url.startsWith('/') ? `${location.origin}${url}` : url);

export function ShareButton({ slug, path, compact = false }: { slug: string; path: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const share = async () => {
    try {
      const { url } = await api.shareFile(slug, path);
      await copyText(absoluteUrl(url), 'Lien de partage');
      setState('copied');
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  const label = state === 'copied' ? 'Lien copié' : state === 'error' ? 'Échec' : 'Partager';
  return (
    <Button variant="ghost" className={cx('h-8 px-2.5', compact && 'size-8 px-0')} onClick={() => void share()} title="Copier un lien de partage privé" aria-label={label}>
      <Link2 className="size-4" strokeWidth={1.5} />
      {!compact && <span className="text-[13px]">{label}</span>}
    </Button>
  );
}

/** Preview of one file: picks the viewer from the extension. Edit and share only in a workspace. */
/** `startEditing`: open the editor as soon as the text is read (a file just created), then `onEditingStarted`. */
export function Preview({ scope, path, onClose, startEditing, onEditingStarted }: {
  scope: FileScope; path: string; onClose?: () => void; startEditing?: boolean; onEditingStarted?: () => void;
}) {
  const qc = useQueryClient();
  const slug = scope.workspace;
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const name = baseName(path);
  const listing = useQuery({ queryKey: [...scope.key, parent], queryFn: () => scope.tree(parent) });
  const entry = listing.data?.entries.find((e) => e.path === path);
  const kind = fileKind(name);
  const isText = kind === 'text' || kind === 'markdown';
  const tooBig = (entry?.size ?? 0) > TEXT_MAX;
  const text = useQuery({
    queryKey: ['file-text', ...(slug ? [slug] : scope.key), path, entry?.mtime],
    queryFn: async () => {
      const res = await fetch(scope.raw(path), { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'Fichier introuvable' : `HTTP ${res.status}`);
      return res.text();
    },
    enabled: isText && Boolean(entry) && !tooBig,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  // text and mtime as they were when editing began: a refresh of the listing or of the text must neither
  // move the conflict check to the new mtime (silent overwrite) nor replace the editor contents
  const [base, setBase] = useState<{ text: string; mtime: number } | null>(null);
  const [source, setSource] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEditing(false); setDraft(null); setBase(null); setSource(false); setError(null); }, [path]);
  const canEdit = Boolean(slug && isText && entry && !tooBig);
  useEffect(() => {
    if (!startEditing || !entry) return;
    if (canEdit && text.data !== undefined) {
      setBase({ text: text.data, mtime: entry.mtime });
      setSource(true);
      setEditing(true);
      onEditingStarted?.();
    } else if (!canEdit) onEditingStarted?.(); // not editable here: the normal preview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing, canEdit, entry, text.data]);

  const save = async () => {
    if (!slug || !base || draft === null) { setEditing(false); setBase(null); return; }
    setSaving(true);
    setError(null);
    try {
      await api.saveText(slug, path, draft, base.mtime);
      setEditing(false);
      setDraft(null);
      setBase(null);
      await qc.invalidateQueries({ queryKey: [...scope.key, parent] });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? new Error('Modifié sur le disque depuis l’ouverture : recharger le fichier') : err);
    } finally {
      setSaving(false);
    }
  };

  const missing = listing.isSuccess && !entry;
  const url = scope.raw(path);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate font-mono text-[11px] text-ink-faint">{path}{entry && entry.kind !== 'dir' ? ` · ${formatSize(entry.size)}` : ''}</p>
        </div>
        {slug && isText && entry && !tooBig && (editing ? (
          <Button variant="primary" className="h-8 px-3" onClick={() => void save()} disabled={saving}>
            <Save className="size-4" strokeWidth={1.5} />Enregistrer
          </Button>
        ) : (
          <Button variant="ghost" className="h-8 px-2.5" onClick={() => {
            if (text.data === undefined) return;
            setBase({ text: text.data, mtime: entry.mtime });
            setSource(true);
            setEditing(true);
          }} disabled={text.data === undefined} title="Modifier">
            <Pencil className="size-4" strokeWidth={1.5} /><span className="hidden text-[13px] sm:inline">Modifier</span>
          </Button>
        ))}
        {slug && entry && <ShareButton slug={slug} path={path} compact />}
        <a href={url} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" title="Ouvrir dans un onglet" aria-label="Ouvrir">
          <ExternalLink className="size-4" strokeWidth={1.5} />
        </a>
        <a href={scope.raw(path, true)} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" title="Télécharger" aria-label="Télécharger">
          <Download className="size-4" strokeWidth={1.5} />
        </a>
        {onClose && (
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" aria-label="Fermer l’aperçu" title="Fermer">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        )}
      </header>
      {kind === 'markdown' && !editing && text.data !== undefined && (
        <div className="flex gap-1 border-b border-line px-4 py-1.5 text-xs">
          {(['Rendu', 'Source'] as const).map((l) => (
            <button key={l} onClick={() => setSource(l === 'Source')}
              className={cx('rounded-md px-2 py-1', (l === 'Source') === source ? 'bg-raised text-ink' : 'text-ink-faint hover:text-ink')}>{l}</button>
          ))}
        </div>
      )}
      <div className="mb-0 empty:hidden px-4 pt-3"><ErrorText error={error ?? text.error ?? listing.error} /></div>
      <div className="min-h-0 flex-1 overflow-auto">
        {missing ? (
          <p className="p-6 text-sm text-ink-soft">Fichier introuvable : il a peut-être été déplacé ou supprimé.</p>
        ) : !entry ? null : kind === 'image' ? (
          <div className="flex min-h-full items-center justify-center bg-raised/40 p-4"><img src={url} alt={name} className="max-h-[75vh] max-w-full object-contain" /></div>
        ) : kind === 'pdf' ? (
          // no sandbox attribute: Chrome refuses PDFs in sandboxed frames; the CSP sandbox header protects
          <iframe src={url} title={name} className="h-full min-h-[70vh] w-full border-0" />
        ) : kind === 'html' || kind === 'svg' ? (
          <iframe src={url} title={name} sandbox="" className="h-full min-h-[70vh] w-full border-0 bg-white" />
        ) : kind === 'audio' ? (
          <div className="p-6"><audio src={url} controls className="w-full" /></div>
        ) : kind === 'video' ? (
          <div className="p-4"><video src={url} controls className="max-h-[75vh] w-full" /></div>
        ) : isText && !tooBig ? (
          text.data === undefined ? null : kind === 'markdown' && !source && !editing ? (
            <div className="px-6 py-5"><Md text={text.data} /></div>
          ) : (
            <Suspense fallback={<pre className="p-4 font-mono text-xs whitespace-pre-wrap">{text.data}</pre>}>
              {/* while editing, the editor starts from base.text (stable: CodeView rebuilds on a new value); edits go to draft */}
              <CodeView name={name} value={editing && base ? base.text : text.data} editable={editing} onChange={setDraft} />
            </Suspense>
          )
        ) : (
          <div className="p-6 text-sm text-ink-soft">
            <p>{tooBig ? 'Fichier trop gros pour l’aperçu.' : 'Pas d’aperçu pour ce type de fichier.'}</p>
            <a href={scope.raw(path, true)} className="mt-3 inline-flex items-center gap-2 text-accent-ink hover:underline">
              <Download className="size-4" strokeWidth={1.5} />Télécharger
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
