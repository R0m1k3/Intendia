import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FolderOpen, PenLine, Pencil, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type FileEntry, type PublicInstance } from '../api';
import { ChatNotice } from '../components/ChatNotice';
import { askText } from '../components/Dialog';
import { DetailBody, DetailHeader } from '../components/Panes';
import { Button, ErrorText } from '../components/ui';
import { FileRows, isDirEntry } from '../files/FileRows';
import { workspaceScope } from '../files/scope';
import { newKey, useCopyOps } from '../sessions/copies';
import { SessionSelectList } from '../sessions/Selection';
import { invalidateSessionLists } from '../sessions/UndoBar';
import { OtherSessions } from './OtherSessions';
import { plural, t } from '../i18n';

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
      await invalidateSessionLists(qc);
      void qc.invalidateQueries({ queryKey: ['workspaces'] }); // session counters
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
    },
  });
  const saveAgents = useMutation({
    mutationFn: (body: string) => api.saveAgentsMd(slug, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents-md', slug] }).then(() => setText(null)),
  });
  const { canCopy } = useCopyOps(w?.instanceId);
  /** A JSON export (Intendia or Hermes) as a new session of this workspace. */
  const importFile = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 10 * 1024 * 1024) throw new Error(t('Fichier trop gros (10 Mo au plus)'));
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(t('Ce fichier n’est pas un JSON lisible'));
      }
      return api.importSession(slug, parsed, newKey());
    },
    onSuccess: async ({ session }) => {
      await invalidateSessionLists(qc);
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      await navigate({ to: '/w/$slug/s/$sessionId', params: { slug, sessionId: session.id } });
    },
  });
  const saveName = useMutation({
    mutationFn: (n: string) => api.updateWorkspace(slug, { name: n }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['workspace', slug] }), qc.invalidateQueries({ queryKey: ['workspaces'] })]),
  });
  const rename = async () => {
    if (!w) return;
    const n = await askText({ title: t('Renommer le workspace'), label: t('Nom affiché'), value: w.name, maxLength: 80, message: t('Le dossier reste {slug}/ : seul le nom change.', { slug: w.slug }), confirmLabel: t('Renommer') });
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
        meta={w && <span title={instance?.files?.workspaceRoot ? `${instance.files.workspaceRoot}/${w.slug}` : undefined}>{t('{slug}/ · agent {profile} · {instance}', { slug: w.slug, profile: w.profile ?? 'default', instance: instance?.label ?? w.instanceId })}</span>}
        back={back ? { to: '/w' } : undefined}
        actions={(
          <>
            <Button onClick={() => void rename()} disabled={!w || saveName.isPending}><Pencil className="size-4" strokeWidth={1.5} />{t('Renommer')}</Button>
            {canCopy && (
              <label className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-lg border border-line bg-sheet px-3.5 text-[13.5px] font-medium transition-colors hover:bg-paper">
                <Upload className="size-4" strokeWidth={1.5} />{t('Importer')}
                <input
                  type="file" accept=".json,application/json" className="sr-only" aria-label={t('Importer une session (JSON)')} disabled={importFile.isPending}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile.mutate(f); }}
                />
              </label>
            )}
            <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
              <PenLine className="size-4" strokeWidth={1.5} />{create.isPending ? t('Création…') : t('Nouvelle session ici')}
            </Button>
          </>
        )}
      />
      <DetailBody>
        <ErrorText error={ws.error} />
        <div className="empty:hidden"><ChatNotice instanceId={w?.instanceId} /></div>
        <ErrorText error={create.error} />
        <ErrorText error={saveName.error} />
        <ErrorText error={importFile.error} />

        <section aria-labelledby="ws-consignes">
          <div className="flex items-baseline gap-2">
            <h3 id="ws-consignes" className="text-[15px] font-semibold">{t('Consignes du workspace')}</h3>
            <span className="font-mono text-[11px] text-ink-faint">AGENTS.md</span>
          </div>
          <p className="mb-2 mt-0.5 text-[13px] text-ink-faint">{t('Envoyées à l’agent avec chaque message de ce dossier (4 premiers Kio)')}</p>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveAgents.mutate(agentsValue); }}>
            <textarea
              value={agentsValue}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              disabled={!agents.isSuccess}
              aria-label={t('Consignes du projet')}
              placeholder={t('Ex. Réponds en français, envoie les fichiers sur Telegram')}
              className="w-full resize-y rounded-[10px] border border-line bg-sheet p-3 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
            <ErrorText error={saveAgents.error} />
            {text !== null && text !== agents.data?.text && <Button variant="dark" disabled={saveAgents.isPending}>{t('Enregistrer')}</Button>}
          </form>
        </section>

        <section className="card overflow-hidden" aria-labelledby="ws-files">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <h3 id="ws-files" className="flex-1 text-[15px] font-semibold">{t('Fichiers')}</h3>
            <Link to="/w/$slug/fichiers" params={{ slug }}
              className="inline-flex h-[34px] items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium transition-colors hover:bg-raised">
              <FolderOpen className="size-4" strokeWidth={1.5} />{t('Parcourir')}
            </Link>
          </div>
          <div className="border-t border-line/70">
            {files.length > 0 ? (
              <FileRows scope={scope} entries={files.slice(0, ROWS)} onOpen={openFile} />
            ) : (
              <p className="px-4 py-3 text-sm text-ink-faint">{tree.isSuccess ? t('Aucun fichier pour l’instant') : tree.isError ? t('Dossier injoignable') : t('Chargement…')}</p>
            )}
            {files.length > ROWS && (
              <Link to="/w/$slug/fichiers" params={{ slug }} className="block border-t border-line/70 px-4 py-2.5 text-[13px] text-ink-soft hover:bg-paper hover:text-ink">
                {plural(files.length - ROWS, '{n} autre élément', '{n} autres éléments')}
              </Link>
            )}
          </div>
        </section>

        <section className="card overflow-hidden" aria-labelledby="ws-sessions">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <h3 id="ws-sessions" className="flex-1 text-[15px] font-semibold">{archived ? t('Sessions archivées') : t('Sessions')}</h3>
            <Button variant="ghost" className="h-8 text-xs" onClick={() => setArchived(!archived)}>{archived ? t('Sessions en cours') : t('Archivées')}</Button>
          </div>
          {sessions.isSuccess && list.length === 0 && (
            <p className="border-t border-line/70 px-4 py-3 text-sm text-ink-faint">{archived ? t('Aucune session archivée') : t('Aucune session : ouvrez-en une pour écrire à l’agent')}</p>
          )}
          {w && sessions.data && list.length > 0 && <div className="border-t border-line/70"><SessionSelectList workspace={w} sessions={list} /></div>}
        </section>

        {instance && <OtherSessions key={instance.id} inst={instance} />}
      </DetailBody>
    </>
  );
}
