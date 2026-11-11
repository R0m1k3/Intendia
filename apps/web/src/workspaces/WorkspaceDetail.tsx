import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FolderOpen, PenLine, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type FileEntry, type PublicInstance } from '../api';
import { ChatNotice } from '../components/ChatNotice';
import { askText } from '../components/Dialog';
import { DetailBody, DetailHeader } from '../components/Panes';
import { Button, cx, ErrorText, timeAgo } from '../components/ui';
import { FileRows, isDirEntry } from '../files/FileRows';
import { workspaceScope } from '../files/scope';
import { OtherSessions } from './OtherSessions';

const ROWS = 8;

/** One workspace: instructions (AGENTS.md), its top-level files, its sessions; "Nouvelle session ici". */
export function WorkspaceDetail({ slug, instance, back }: { slug: string; instance?: PublicInstance; back: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const [archived, setArchived] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions', slug, archived], queryFn: () => api.sessions(slug, archived) });
  const agents = useQuery({ queryKey: ['agents-md', slug], queryFn: () => api.agentsMd(slug) });
  const scope = workspaceScope(slug);
  const tree = useQuery({ queryKey: ['tree', slug, ''], queryFn: () => api.tree(slug, '') });
  const [text, setText] = useState<string | null>(null);
  const w = ws.data?.workspace;

  useEffect(() => { setText(null); setArchived(false); }, [slug]);

  const create = useMutation({
    mutationFn: () => api.createSession(slug),
    onSuccess: async ({ session }) => {
      await qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['workspaces'] }); // session counters
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
    },
  });
  const saveAgents = useMutation({
    mutationFn: (t: string) => api.saveAgentsMd(slug, t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents-md', slug] }).then(() => setText(null)),
  });
  const saveName = useMutation({
    mutationFn: (n: string) => api.updateWorkspace(slug, { name: n }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['workspace', slug] }), qc.invalidateQueries({ queryKey: ['workspaces'] })]),
  });
  const rename = async () => {
    if (!w) return;
    const n = await askText({ title: 'Renommer le workspace', label: 'Nom affiché', value: w.name, maxLength: 80, message: `Le dossier reste ${w.slug}/ : seul le nom change.`, confirmLabel: 'Renommer' });
    if (n && n !== w.name) saveName.mutate(n);
  };
  const openFile = (e: FileEntry) => {
    const dir = isDirEntry(e) ? e.path : e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '';
    void navigate({ to: '/w/$slug/fichiers', params: { slug }, search: { path: dir || undefined, f: isDirEntry(e) ? undefined : e.path } });
  };

  const agentsValue = text ?? agents.data?.text ?? '';
  const files = tree.data?.entries ?? [];
  const list = sessions.data?.sessions ?? [];

  return (
    <>
      <DetailHeader
        title={w?.name ?? slug}
        meta={w && <span title={instance?.files?.workspaceRoot ? `${instance.files.workspaceRoot}/${w.slug}` : undefined}>{w.slug}/ · agent {w.profile ?? 'default'} · {instance?.label ?? w.instanceId}</span>}
        back={back ? { to: '/w' } : undefined}
        actions={(
          <>
            <Button onClick={() => void rename()} disabled={!w || saveName.isPending}><Pencil className="size-4" strokeWidth={1.5} />Renommer</Button>
            <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
              <PenLine className="size-4" strokeWidth={1.5} />{create.isPending ? 'Création…' : 'Nouvelle session ici'}
            </Button>
          </>
        )}
      />
      <DetailBody>
        <ErrorText error={ws.error} />
        <div className="empty:hidden"><ChatNotice instanceId={w?.instanceId} /></div>
        <ErrorText error={create.error} />
        <ErrorText error={saveName.error} />

        <section aria-labelledby="ws-consignes">
          <div className="flex items-baseline gap-2">
            <h3 id="ws-consignes" className="text-[15px] font-semibold">Consignes du workspace</h3>
            <span className="font-mono text-[11px] text-ink-faint">AGENTS.md</span>
          </div>
          <p className="mb-2 mt-0.5 text-[13px] text-ink-faint">Envoyées à l’agent avec chaque message de ce dossier (4 premiers Kio)</p>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveAgents.mutate(agentsValue); }}>
            <textarea
              value={agentsValue}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              disabled={!agents.isSuccess}
              aria-label="Consignes du projet"
              placeholder="Ex. Réponds en français, envoie les fichiers sur Telegram"
              className="w-full resize-y rounded-[10px] border border-line bg-sheet p-3 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
            <ErrorText error={saveAgents.error} />
            {text !== null && text !== agents.data?.text && <Button variant="dark" disabled={saveAgents.isPending}>Enregistrer</Button>}
          </form>
        </section>

        <section className="card overflow-hidden" aria-labelledby="ws-files">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <h3 id="ws-files" className="flex-1 text-[15px] font-semibold">Fichiers</h3>
            <Link to="/w/$slug/fichiers" params={{ slug }}
              className="inline-flex h-[34px] items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium transition-colors hover:bg-raised">
              <FolderOpen className="size-4" strokeWidth={1.5} />Parcourir
            </Link>
          </div>
          <div className="border-t border-line/70">
            {files.length > 0 ? (
              <FileRows scope={scope} entries={files.slice(0, ROWS)} onOpen={openFile} />
            ) : (
              <p className="px-4 py-3 text-sm text-ink-faint">{tree.isSuccess ? 'Aucun fichier pour l’instant' : tree.isError ? 'Dossier injoignable' : 'Chargement…'}</p>
            )}
            {files.length > ROWS && (
              <Link to="/w/$slug/fichiers" params={{ slug }} className="block border-t border-line/70 px-4 py-2.5 text-[13px] text-ink-soft hover:bg-paper hover:text-ink">
                {files.length - ROWS} autre{files.length - ROWS > 1 ? 's' : ''} élément{files.length - ROWS > 1 ? 's' : ''}
              </Link>
            )}
          </div>
        </section>

        <section className="card overflow-hidden" aria-labelledby="ws-sessions">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <h3 id="ws-sessions" className="flex-1 text-[15px] font-semibold">{archived ? 'Sessions archivées' : 'Sessions'}</h3>
            <Button variant="ghost" className="h-8 text-xs" onClick={() => setArchived(!archived)}>{archived ? 'Sessions en cours' : 'Archivées'}</Button>
          </div>
          {sessions.isSuccess && list.length === 0 && (
            <p className="border-t border-line/70 px-4 py-3 text-sm text-ink-faint">{archived ? 'Aucune session archivée' : 'Aucune session : ouvrez-en une pour écrire à l’agent'}</p>
          )}
          <ul>
            {list.map((s) => (
              <li key={s.id} className="border-t border-line/70">
                <Link to="/w/$slug/s/$sessionId" params={{ slug, sessionId: s.id }} className="flex h-12 items-center gap-3.5 px-4 text-sm transition-colors hover:bg-paper">
                  <span className={cx('min-w-0 flex-1 truncate', !s.title && 'text-ink-faint')}>{s.title || 'Nouvelle session'}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{timeAgo(s.lastActiveAt ?? s.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {instance && <OtherSessions key={instance.id} inst={instance} />}
      </DetailBody>
    </>
  );
}
