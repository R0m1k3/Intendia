import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, GitBranch, RefreshCw, X } from 'lucide-react';
import { api, gitDiffUrl, type GitDiffWhich, type GitFile } from '../api';
import { PageHeader } from '../components/Layout';
import { ModuleNotice } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Panel } from '../components/ui';
import DiffView from '../files/viewers/DiffView';
import { GIT_REQUIRED, GitFiles } from '../git/GitFiles';

export interface GitSearch {
  /** Repository folder, relative to the workspace ('' = the workspace itself). */
  repo: string;
  /** Selected file, relative to the repository. */
  f?: string;
}

const STALE = 10_000;

/** The diffs to show for a file: staged and/or unstaged, or everything against HEAD when Hermes did not tell. */
function diffsOf(file: GitFile): { which: GitDiffWhich; title: string }[] {
  if (file.status === '?') return [{ which: 'unstaged', title: 'Nouveau fichier' }];
  if (file.conflicted || (file.staged && file.unstaged === null)) return [{ which: 'all', title: 'Toutes les modifications' }];
  if (file.staged && file.unstaged) return [{ which: 'staged', title: 'Indexé' }, { which: 'unstaged', title: 'Non indexé' }];
  return [file.staged ? { which: 'staged', title: 'Indexé' } : { which: 'unstaged', title: 'Non indexé' }];
}

function FileDiff({ slug, repo, file, version, onClose }: { slug: string; repo: string; file: GitFile; version: number; onClose: () => void }) {
  const diffs = file.dir || file.sensitive ? [] : diffsOf(file);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{file.path}</span>
        <button onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-ink-soft hover:bg-raised hover:text-ink" aria-label="Fermer le diff">
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {file.dir ? (
          <p className="p-6 text-sm text-ink-faint">Dossier non suivi : son contenu apparaîtra fichier par fichier une fois indexé.</p>
        ) : file.sensitive ? (
          <p className="p-6 text-sm text-ink-faint">Fichier sensible (identifiants) : diff non affiché.</p>
        ) : diffs.map((d) => (
          <section key={d.which} data-diff={d.which}>
            {diffs.length > 1 && <h3 className="border-b border-line/70 bg-paper px-4 py-1.5 text-[12.5px] font-medium text-ink-faint">{d.title}</h3>}
            <DiffView url={gitDiffUrl(slug, repo, file.path, d.which)} version={version} />
          </section>
        ))}
      </div>
    </div>
  );
}

export function GitPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const search = useSearch({ strict: false }) as GitSearch;
  const repo = search.repo ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ['workspace', slug], queryFn: () => api.workspace(slug) });
  const status = useQuery({ queryKey: ['git', slug, repo, 'status'], queryFn: () => api.gitStatus(slug, repo), staleTime: STALE, retry: false });
  const go = (s: Partial<GitSearch>, replace = false) => navigate({ to: '/w/$slug/git', params: { slug }, search: { repo, ...s }, replace });

  const st = status.data;
  const selected = search.f ? st?.files.find((f) => f.path === search.f) ?? null : null;
  const name = repo ? repo.split('/').at(-1)! : slug;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['git', slug, repo] });

  return (
    <div>
      <PageHeader
        eyebrow={<Link to="/w/$slug" params={{ slug }} className="hover:text-ink">{ws.data?.workspace.name ?? slug}</Link>}
        title="Git"
        subtitle={<span className="font-mono">{repo ? `${slug}/${repo}` : slug}</span>}
        action={
          <div className="flex items-center gap-2">
            <Link to="/w/$slug/fichiers" params={{ slug }} search={repo ? { path: repo } : {}}
              className="inline-flex h-[34px] items-center rounded-lg border border-line bg-sheet px-3.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-paper">
              Fichiers
            </Link>
            <Button onClick={refresh} disabled={status.isFetching}>
              <RefreshCw className={cx('size-4', status.isFetching && 'animate-spin')} strokeWidth={1.5} />Actualiser
            </Button>
          </div>
        }
      />
      <div className="px-4 pb-4 md:px-8 empty:hidden">
        <ModuleNotice instanceId={ws.data?.workspace.instanceId} module="git" title="Git" required={GIT_REQUIRED} optional={[]} />
      </div>
      <div className={cx('grid gap-5 px-4 pb-14 md:px-8', selected ? 'lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]' : 'max-w-[1000px]')}>
        <Panel
          className="min-w-0 self-start overflow-hidden"
          bodyClassName="border-t border-line/70"
          title={
            <span className="flex min-w-0 items-center gap-2 text-[14px]">
              <GitBranch className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} />
              <span className="truncate font-mono" data-branch>{st ? (st.detached ? 'HEAD détaché' : st.branch ?? '?') : name}</span>
            </span>
          }
          action={st && (st.ahead > 0 || st.behind > 0) ? (
            <span className="flex items-center gap-2 font-mono text-[12.5px] text-ink-soft" title="Depuis la dernière récupération (fetch)">
              {st.ahead > 0 && <span className="flex items-center"><ArrowUp className="size-3.5" strokeWidth={1.5} />{st.ahead}</span>}
              {st.behind > 0 && <span className="flex items-center"><ArrowDown className="size-3.5" strokeWidth={1.5} />{st.behind}</span>}
              <span className="font-sans text-ink-faint">depuis la dernière récupération</span>
            </span>
          ) : undefined}
        >
          <div className="px-4 pt-3 empty:hidden"><ErrorText error={status.error} /></div>
          {st && (st.files.length ? (
            <GitFiles files={st.files} selected={search.f ?? null} onSelect={(f) => void go({ f: f.path })} />
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium">Aucune modification</p>
              <p className="mt-1 text-sm text-ink-faint">Le dossier est identique au dernier commit</p>
            </div>
          ))}
          {st?.truncated && <p className="border-t border-line/70 px-4 py-2 text-xs text-ink-faint">1 000 premiers fichiers affichés</p>}
          <p className="border-t border-line/70 px-4 py-2.5 text-xs text-ink-faint">
            Récupérer les nouveautés (pull) : pas proposé par Hermes 0.23, demandez-le à l’agent.
          </p>
        </Panel>
        {selected && (
          <section className="fixed inset-0 z-30 bg-sheet lg:sticky lg:top-6 lg:z-auto lg:h-[calc(var(--content-h)-3rem)] lg:overflow-hidden lg:rounded-xl lg:border lg:border-line">
            <FileDiff slug={slug} repo={repo} file={selected} version={status.dataUpdatedAt} onClose={() => void go({ f: undefined })} />
          </section>
        )}
      </div>
    </div>
  );
}
