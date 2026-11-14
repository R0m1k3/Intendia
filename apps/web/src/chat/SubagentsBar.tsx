import { GitBranch } from 'lucide-react';
import type { SubagentsSummary } from '../api';
import { plural, t } from '../i18n';

/** « 2 sous-agents travaillent · l’agent reprendra à leur fin » */
export function subagentsLine(n: number): string {
  return plural(n, '{n} sous-agent travaille · l’agent reprendra à sa fin', '{n} sous-agents travaillent · l’agent reprendra à leur fin');
}

/**
 * Above the composer while background sub-agents work and no run goes on: the server wakes the agent once they all
 * delivered (server: chat/wake.ts). The count comes from the server's summary.
 */
export function SubagentsBar({ summary, onStop }: { summary: SubagentsSummary; onStop?: () => void }) {
  return (
    <div className="mb-2" data-subagents-bar>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-sheet px-3 py-1.5 text-[13px] text-ink-soft">
        <GitBranch className="size-4 shrink-0 text-accent-ink" strokeWidth={1.75} />
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="min-w-0 truncate" data-subagents-count={summary.openTasks}>{subagentsLine(summary.openTasks)}</span>
        {onStop && (
          <button type="button" onClick={onStop} data-subagents-stop
            className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-[12px] text-ink-soft hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
            {t('Ne plus attendre')}
          </button>
        )}
      </div>
    </div>
  );
}
