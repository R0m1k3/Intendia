import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronRight, FolderOpen, Link2, Search, X, FileArchive } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type FileEntry } from '../api';
import { PageHeader } from '../components/Layout';
import { Empty } from '../components/Panes';
import { Button, Chips, cx, ErrorText, Input, Panel } from '../components/ui';
import { FileRows, isDirEntry } from '../files/FileRows';
import { LinkRow } from '../files/LinkRow';
import { Preview } from '../files/Preview';
import { instanceScope } from '../files/scope';
import { plural, t } from '../i18n';
import { T } from '../i18n/T';

export type InstanceFilesTab = 'fichiers' | 'liens';
export interface InstanceFilesSearch {
  tab?: InstanceFilesTab;
  path?: string;
  f?: string;
}

/**
 * « Fichiers »: the whole file root of the current instance, read only (every workspace folder and what the agent
 * made beside them), and the share links of the instance. Writing happens in the explorer of a workspace.
 */
export function InstanceFilesPage() {
  const { inst } = useParams({ strict: false }) as { inst: string };
  const search = useSearch({ strict: false }) as InstanceFilesSearch;
  const tab = search.tab ?? 'fichiers';
  const navigate = useNavigate();
  const instances = useQuery({ queryKey: ['instances'], queryFn: api.instances });
  const label = instances.data?.instances.find((i) => i.id === inst)?.label ?? inst;
  const go = (s: InstanceFilesSearch) => navigate({ to: '/i/$inst/files', params: { inst }, search: s });

  return (
    <div>
      <PageHeader
        title={t('Fichiers')}
        subtitle={<T k="Tous les fichiers de {label}, en lecture ; on écrit dans le dossier d’un workspace" vars={{ label: <span className="text-ink">{label}</span> }} />}
      />
      <div className="px-4 pb-5 md:px-8">
        <Chips
          role="tab" label={t('Fichiers')} value={tab}
          items={[{ key: 'fichiers', label: t('Fichiers') }, { key: 'liens', label: t('Liens partagés') }]}
          onChange={(k) => void go(k === 'fichiers' ? {} : { tab: k })}
        />
      </div>
      {tab === 'liens' ? <SharedLinks inst={inst} /> : <Browser inst={inst} search={search} go={go} />}
    </div>
  );
}

function Browser({ inst, search, go }: { inst: string; search: InstanceFilesSearch; go: (s: InstanceFilesSearch) => Promise<void> }) {
  const dir = search.path ?? '';
  const open = search.f ?? null;
  const scope = useMemo(() => instanceScope(inst), [inst]);
  const tree = useQuery({ queryKey: [...scope.key, dir], queryFn: () => scope.tree(dir) });
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(timer); }, [q]);
  const found = useQuery({ queryKey: ['instance-file-search', inst, debounced], queryFn: () => api.instanceSearchFiles(inst, debounced), enabled: debounced.length > 0 });

  const onOpen = (e: FileEntry) => {
    if (isDirEntry(e)) {
      setQ('');
      void go({ path: e.path });
    } else void go({ path: e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '', f: e.path });
  };

  const crumbs = dir ? dir.split('/') : [];
  const entries = debounced ? found.data?.results ?? [] : tree.data?.entries ?? [];
  const workspaces = dir ? [] : entries.filter((e) => e.workspace);
  // the workspace that contains the open folder (first segment), for the « Ouvrir le workspace » link
  const inWorkspace = crumbs[0] ?? null;
  const ws = useQuery({ queryKey: [...scope.key, ''], queryFn: () => scope.tree(''), enabled: Boolean(inWorkspace) });
  const wsSlug = inWorkspace && ws.data?.entries.find((e) => e.name === inWorkspace)?.workspace;

  return (
    <div className={cx('grid gap-5 px-4 pb-14 md:px-8', open ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]' : 'max-w-[1000px]')}>
      <Panel
        className="min-w-0 overflow-hidden"
        bodyClassName="border-t border-line/70"
        title={
          <nav aria-label={t('Dossier')} className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[13px] font-normal">
            <button onClick={() => void go({})} className={cx(crumbs.length ? 'text-ink-faint hover:text-ink' : 'text-ink')}>{t('racine')}</button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-ink-faint" strokeWidth={1.5} />
                <button onClick={() => void go({ path: crumbs.slice(0, i + 1).join('/') })} className={i === crumbs.length - 1 ? 'text-ink' : 'text-ink-faint hover:text-ink'}>{c}</button>
              </span>
            ))}
          </nav>
        }
        action={
          <div className="flex items-center gap-1">
            <a href={scope.zip(dir)} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" title={t('Télécharger ce dossier (zip)')} aria-label={t('Télécharger ce dossier (zip)')}>
              <FileArchive className="size-4" strokeWidth={1.5} />
            </a>
          <div className="relative w-40 shrink-0 sm:w-48">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-faint" strokeWidth={1.5} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Chercher un nom')} className="h-9 pl-8" aria-label={t('Chercher un fichier')} />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2 top-2.5 text-ink-faint hover:text-ink" aria-label={t('Effacer')}><X className="size-4" strokeWidth={1.5} /></button>
            )}
          </div>
          </div>
        }
      >
        <div className="px-4 pt-3 empty:hidden"><ErrorText error={debounced ? found.error : tree.error} /></div>
        {wsSlug && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-paper px-4 py-2.5 text-[13px] text-ink-soft">
            <T k="Dossier du workspace {slug} : pour déposer, renommer ou modifier, {link}" vars={{
              slug: <span className="font-mono">{wsSlug}</span>,
              link: <Link to="/w/$slug/fichiers" params={{ slug: wsSlug }} search={{ path: crumbs.slice(1).join('/') || undefined }} className="font-medium text-ink underline underline-offset-2">{t('ouvrez le workspace')}</Link>,
            }} />
          </p>
        )}
        {debounced && <p className="px-4 pb-2 pt-1 text-xs text-ink-faint">{found.isFetching ? t('Recherche…') : plural(entries.length, '{n} résultat dans toute l’instance', '{n} résultats dans toute l’instance') + (found.data?.truncated ? t(' (liste coupée)') : '')}</p>}
        {entries.length > 0 ? (
          <FileRows scope={scope} entries={entries} selected={open} onOpen={onOpen} agentRoot={tree.data?.agentRoot} />
        ) : (tree.isSuccess && !debounced) ? (
          <p className="border-t border-line/70 px-4 py-12 text-center text-sm text-ink-faint">{t('Dossier vide')}</p>
        ) : null}
        {workspaces.length > 0 && !debounced && (
          <div className="border-t border-line/70 px-4 py-3">
            <p className="mb-2 text-xs text-ink-faint">{t('Workspaces de cette instance')}</p>
            <div className="flex flex-wrap gap-2">
              {workspaces.map((e) => (
                <Link key={e.path} to="/w/$slug/fichiers" params={{ slug: e.workspace! }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] font-medium hover:bg-paper">
                  <FolderOpen className="size-4 text-ink-faint" strokeWidth={1.5} />{t('Ouvrir {name}', { name: e.name })}
                </Link>
              ))}
            </div>
          </div>
        )}
        {tree.data?.truncated && !debounced && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">{t('Dossier coupé à 2 000 éléments : utilisez la recherche')}</p>}
      </Panel>
      {open && (
        <section className="fixed inset-0 z-30 bg-sheet lg:sticky lg:top-6 lg:z-auto lg:h-[calc(var(--content-h)-3rem)] lg:overflow-hidden lg:rounded-xl lg:border lg:border-line">
          <Preview scope={scope} path={open} onClose={() => void go({ path: dir || undefined })} />
        </section>
      )}
    </div>
  );
}

function SharedLinks({ inst }: { inst: string }) {
  const links = useQuery({ queryKey: ['links'], queryFn: api.links });
  const navigate = useNavigate();
  const list = (links.data?.links ?? []).filter((l) => l.instanceId === inst);
  const live = list.filter((l) => !l.revoked);
  const revoked = list.filter((l) => l.revoked);
  return (
    <div className="flex max-w-[1000px] flex-col gap-5 px-4 pb-14 md:px-8">
      <p className="text-ink-faint">{t('Liens vers des fichiers de cette instance, privés par défaut : il faut être connecté pour les ouvrir. L’agent ne crée que des liens privés.')}</p>
      <ErrorText error={links.error} />
      {links.isSuccess && list.length === 0 ? (
        <div className="card">
          <Empty
            icon={<Link2 strokeWidth={1.5} />}
            title={t('Aucun lien pour l’instant')}
            actions={(
              <>
                <Button variant="dark" onClick={() => void navigate({ to: '/i/$inst/files', params: { inst } })}>{t('Parcourir les fichiers')}</Button>
                <Button onClick={() => void navigate({ to: '/', search: { nouvelle: 1 } })}>{t('Demander à Hermes')}</Button>
              </>
            )}
          >
            {t('Partagez un fichier depuis l’explorateur d’un workspace, ou demandez-le à l’agent. Il ne crée que des liens privés.')}
          </Empty>
        </div>
      ) : (
        <Panel bodyClassName="p-0" title={t('Liens actifs')} action={<span className="font-mono text-xs text-ink-faint">{live.length}</span>}>
          {live.length ? (
            <ul className="divide-y divide-line/70 border-t border-line/70">{live.map((l) => <LinkRow key={l.token} l={l} />)}</ul>
          ) : links.isSuccess ? (
            <p className="border-t border-line/70 px-4 py-8 text-center text-sm text-ink-faint">{t('Aucun lien actif')}</p>
          ) : null}
        </Panel>
      )}
      {revoked.length > 0 && (
        <Panel bodyClassName="p-0" title={t('Révoqués')} action={<span className="font-mono text-xs text-ink-faint">{revoked.length}</span>}>
          <ul className="divide-y divide-line/70 border-t border-line/70">{revoked.map((l) => <LinkRow key={l.token} l={l} />)}</ul>
        </Panel>
      )}
    </div>
  );
}
