import type { GitFile } from '../api';
import type { OpRef } from '../components/ModuleNotice';
import { MoreHorizontal } from 'lucide-react';
import { Menu } from '../components/Menu';
import { cx } from '../components/ui';

/** The reads the Git page cannot do without (the Files page shows its « Git » button only with them). */
export const GIT_REQUIRED: OpRef[] = [['git', 'root'], ['git', 'status'], ['git', 'list'], ['git', 'diff'], ['git', 'fileDiff']];

export interface GitGroups { conflicted: GitFile[]; staged: GitFile[]; unstaged: GitFile[]; untracked: GitFile[] }

/**
 * Files by state. A file staged and changed again is in « Indexés » and in « Modifiés »; when Hermes did not say
 * whether a staged file has more changes (`unstaged: null`), only in « Indexés ».
 */
export function groupFiles(files: GitFile[]): GitGroups {
  const g: GitGroups = { conflicted: [], staged: [], unstaged: [], untracked: [] };
  for (const f of files) {
    if (f.conflicted) g.conflicted.push(f);
    else if (f.status === '?') g.untracked.push(f);
    else {
      if (f.staged) g.staged.push(f);
      if (!f.staged || f.unstaged === true) g.unstaged.push(f);
    }
  }
  return g;
}

export type GitGroup = keyof GitGroups;

const TITLES: Record<GitGroup, string> = { conflicted: 'En conflit', staged: 'Indexés', unstaged: 'Modifiés', untracked: 'Non suivis' };
const ORDER: GitGroup[] = ['conflicted', 'staged', 'unstaged', 'untracked'];

const LETTER: Record<string, string> = { M: 'modifié', A: 'ajouté', D: 'supprimé', R: 'renommé', C: 'copié', U: 'en conflit', '?': 'non suivi' };

export interface GitFileActions {
  busy: boolean;
  /** Checkbox: stage (`true`) or unstage (`false`) one file. */
  onStage: (f: GitFile, stage: boolean) => void;
  onRevert: (f: GitFile) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  canStage: boolean;
  canUnstage: boolean;
  canRevert: boolean;
}

/** A file whose changes Intendia can discard (never a folder, a credential file, a rename or a copy). */
export const revertable = (f: GitFile) => !f.dir && !f.sensitive && f.status !== 'R' && f.status !== 'C';

/** Changed files of a repository, by group; a click opens the diff. With `actions`: checkboxes and menus. */
export function GitFiles({ files, selected, onSelect, actions }: {
  files: GitFile[]; selected: string | null; onSelect: (f: GitFile) => void; actions?: GitFileActions;
}) {
  const groups = groupFiles(files);
  const a = actions;
  return (
    <div data-git-files>
      {ORDER.filter((k) => groups[k].length).map((k) => (
        <section key={k} data-group={k} className="border-t border-line/70 first:border-t-0">
          <h3 className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 text-[12.5px] font-medium text-ink-faint">
            <span>{TITLES[k]} <span className="font-mono">{groups[k].length}</span></span>
            {a && k === 'staged' && a.canUnstage && (
              <button type="button" disabled={a.busy} onClick={a.onUnstageAll} className="rounded px-1.5 py-0.5 hover:bg-raised hover:text-ink disabled:opacity-50">Tout désindexer</button>
            )}
            {a && (k === 'unstaged' || k === 'untracked') && a.canStage && (
              <button type="button" disabled={a.busy} onClick={a.onStageAll} className="rounded px-1.5 py-0.5 hover:bg-raised hover:text-ink disabled:opacity-50">Tout indexer</button>
            )}
          </h3>
          <ul className="pb-2">
            {groups[k].map((f) => (
              <li key={`${k}:${f.path}`} className={cx('group flex items-center gap-1 pl-2 pr-2 hover:bg-paper', selected === f.path && 'bg-raised')}>
                {a && (
                  <span className="flex w-6 shrink-0 justify-center">
                    {!f.sensitive && (k === 'staged' ? a.canUnstage : a.canStage) && (
                      <input type="checkbox" checked={k === 'staged'} disabled={a.busy} data-stage={f.path}
                        aria-label={k === 'staged' ? `Désindexer ${f.path}` : `Indexer ${f.path}`}
                        onChange={() => a.onStage(f, k !== 'staged')} className="size-3.5 accent-[var(--color-ink)]" />
                    )}
                  </span>
                )}
                <button type="button" onClick={() => onSelect(f)} data-path={f.path}
                  className={cx('flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left text-[13.5px]', !a && 'pl-2')}>
                  <span title={LETTER[f.status] ?? f.status} className={cx('w-4 shrink-0 text-center font-mono text-[12px]',
                    f.status === 'D' ? 'text-bad' : f.status === 'A' || f.status === '?' ? 'text-ok' : f.conflicted ? 'text-warn' : 'text-accent-ink')}>{f.status}</span>
                  <span className={cx('min-w-0 flex-1 truncate font-mono text-[13px]', f.sensitive && 'text-ink-faint')}>{f.path}</span>
                  {f.sensitive && <span className="shrink-0 text-[12px] text-ink-faint">sensible</span>}
                  {!f.dir && (f.added > 0 || f.removed > 0) && (
                    <span className="shrink-0 font-mono text-[12px]"><span className="text-ok">+{f.added}</span> <span className="text-bad">−{f.removed}</span></span>
                  )}
                </button>
                {a && a.canRevert && revertable(f) && (
                  <Menu title={`Actions sur ${f.path}`} align="end"
                    trigger={<MoreHorizontal className="size-4" strokeWidth={1.5} />}
                    triggerClass="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-60 hover:bg-raised hover:text-ink group-hover:opacity-100"
                    items={[{ label: f.status === '?' || f.status === 'A' ? 'Supprimer ce nouveau fichier' : 'Annuler les modifications', danger: true, disabled: a.busy, onSelect: () => a.onRevert(f) }]}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
