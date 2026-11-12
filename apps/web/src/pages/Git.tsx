import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, GitBranch, RefreshCw, X } from 'lucide-react';
import { api, gitDiffUrl, type GitDiffWhich, type GitFile } from '../api';
import { PageHeader } from '../components/Layout';
import { ask } from '../components/Dialog';
import { Picker } from '../components/Menu';
import { ModuleNotice, useModuleAvailability } from '../components/ModuleNotice';
import { Button, cx, ErrorText, Panel } from '../components/ui';
import DiffView from '../files/viewers/DiffView';
import { CommitBox } from '../git/CommitBox';
import { GIT_REQUIRED, GitFiles } from '../git/GitFiles';
import { useState } from 'react';

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
  const inst = ws.data?.workspace.instanceId;
  const { has } = useModuleAvailability(inst, 'git', GIT_REQUIRED, []);
  const compat = useQuery({ queryKey: ['compat'], queryFn: api.compat });
  const oneshotOn = Boolean(compat.data?.reports.find((r) => r.instanceId === inst)?.socket?.oneshot);
  const branches = useQuery({ queryKey: ['git', slug, repo, 'branches'], queryFn: () => api.gitBranches(slug, repo), staleTime: STALE, enabled: has('git', 'branches') && Boolean(st), retry: false });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Runs a write, then refreshes the page and the file lists. */
  const act = async (fn: () => Promise<string | null | void>) => {
    setBusy(true);
    setActionError(null);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ['git', slug, repo] });
      void qc.invalidateQueries({ queryKey: ['tree', slug] });
    }
  };
  const unstagedNote = (u: string[]) => (u.length ? `Laissés hors de l’index (fichiers sensibles) : ${u.join(', ')}` : null);
  const actions = st ? {
    busy,
    canStage: has('git', 'stage'), canUnstage: has('git', 'unstage'), canRevert: has('git', 'revert'),
    onStage: (f: GitFile, stage: boolean) => void act(async () => (stage ? unstagedNote((await api.gitStage(slug, repo, f.path)).unstaged) : void (await api.gitUnstage(slug, repo, f.path)))),
    onStageAll: () => void act(async () => unstagedNote((await api.gitStage(slug, repo)).unstaged)),
    onUnstageAll: () => void act(async () => void (await api.gitUnstage(slug, repo))),
    onRevert: async (f: GitFile) => {
      const fresh = f.status === '?' || f.status === 'A';
      const yes = await ask({
        title: fresh ? 'Supprimer ce nouveau fichier ?' : 'Annuler les modifications ?',
        message: fresh ? `${f.path} sera supprimé.` : `Les modifications de ${f.path} seront perdues (indexées comprises).`,
        confirmLabel: fresh ? 'Supprimer' : 'Annuler les modifications', cancelLabel: 'Garder', danger: true,
      });
      if (yes) void act(async () => { await api.gitRevert(slug, repo, f.path); if (search.f === f.path) void go({ f: undefined }, true); });
    },
  } : undefined;
  const switchTo = async (branch: string | null) => {
    if (!branch || branch === st?.branch) return;
    const yes = await ask({
      title: `Passer sur ${branch} ?`,
      message: 'git refusera si des modifications seraient perdues. Les sessions en cours dans ce dossier verront les fichiers de l’autre branche.',
      confirmLabel: 'Changer de branche', cancelLabel: 'Rester',
    });
    if (yes) void act(async () => { await api.gitSwitch(slug, repo, branch); return `Sur la branche ${branch}`; });
  };

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
              {st && has('git', 'switch') && (branches.data?.branches.length ?? 0) > 1 && (
                <Picker label="Changer" title="Branches locales" placement="below" disabled={busy}
                  value={st.branch} onPick={(v) => void switchTo(v)}
                  items={(branches.data?.branches ?? []).map((b) => ({ value: b.name, label: b.name, mono: true }))} />
              )}
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
          <div className="px-4 pt-3 empty:hidden"><ErrorText error={status.error ?? actionError} /></div>
          {note && (
            <p role="status" className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-paper px-3 py-2 text-sm text-ink-soft">
              <span className="flex-1">{note}</span>
              <button onClick={() => setNote(null)} className="text-ink-faint hover:text-ink" aria-label="Fermer la note"><X className="size-4" strokeWidth={1.5} /></button>
            </p>
          )}
          {st && (st.files.length ? (
            <GitFiles files={st.files} selected={search.f ?? null} onSelect={(f) => void go({ f: f.path })} actions={actions} />
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium">Aucune modification</p>
              <p className="mt-1 text-sm text-ink-faint">Le dossier est identique au dernier commit</p>
            </div>
          ))}
          {st && (has('git', 'commit') || has('git', 'push')) && (
            <CommitBox slug={slug} repo={repo} status={st} canCommit={has('git', 'commit')} canPush={has('git', 'push')}
              canMessage={oneshotOn && has('git', 'context')} onDone={(n) => { setNote(n); refresh(); }} />
          )}
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
