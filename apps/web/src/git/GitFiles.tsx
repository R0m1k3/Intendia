import type { GitFile } from '../api';
import type { OpRef } from '../components/ModuleNotice';
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

/** Changed files of a repository, by group; a click opens the diff. */
export function GitFiles({ files, selected, onSelect }: { files: GitFile[]; selected: string | null; onSelect: (f: GitFile) => void }) {
  const groups = groupFiles(files);
  return (
    <div data-git-files>
      {ORDER.filter((k) => groups[k].length).map((k) => (
        <section key={k} data-group={k} className="border-t border-line/70 first:border-t-0">
          <h3 className="flex items-center justify-between px-4 pb-1 pt-3 text-[12.5px] font-medium text-ink-faint">
            <span>{TITLES[k]}</span><span className="font-mono">{groups[k].length}</span>
          </h3>
          <ul className="pb-2">
            {groups[k].map((f) => (
              <li key={`${k}:${f.path}`}>
                <button type="button" onClick={() => onSelect(f)} data-path={f.path}
                  className={cx('flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13.5px] hover:bg-paper', selected === f.path && 'bg-raised')}>
                  <span title={LETTER[f.status] ?? f.status} className={cx('w-4 shrink-0 text-center font-mono text-[12px]',
                    f.status === 'D' ? 'text-bad' : f.status === 'A' || f.status === '?' ? 'text-ok' : f.conflicted ? 'text-warn' : 'text-accent-ink')}>{f.status}</span>
                  <span className={cx('min-w-0 flex-1 truncate font-mono text-[13px]', f.sensitive && 'text-ink-faint')}>{f.path}</span>
                  {f.sensitive && <span className="shrink-0 text-[12px] text-ink-faint">sensible</span>}
                  {!f.dir && (f.added > 0 || f.removed > 0) && (
                    <span className="shrink-0 font-mono text-[12px]"><span className="text-ok">+{f.added}</span> <span className="text-bad">−{f.removed}</span></span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
