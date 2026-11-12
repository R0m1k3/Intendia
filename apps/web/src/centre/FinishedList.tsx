import { Link } from '@tanstack/react-router';
import type { FinishedRun } from '../api';
import { formatCost } from '../chat/format';
import { Tag, timeAgo } from '../components/ui';
import { finishedStatus, runLength } from './format';

const TONE = { good: 'bg-ok-soft text-ok', bad: 'bg-bad-soft text-bad', neutral: undefined } as const;

/** Runs launched from Intendia ended in the last 24 h, most recent first. */
export function FinishedList({ runs, instanceLabel }: { runs: FinishedRun[]; instanceLabel: (id: string) => string | null }) {
  return (
    <ul className="divide-y divide-line/70 border-t border-line/70" data-finished>
      {runs.map((r) => {
        const st = finishedStatus(r.status);
        const length = runLength(r.startedAt, r.endedAt);
        const label = instanceLabel(r.instance);
        return (
          <li key={`${r.instance}:${r.runId}`} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-4 py-3 text-sm" data-finished-run={r.runId}>
            <div className="min-w-0 flex-1">
              <Link to="/w/$slug/s/$sessionId" params={{ slug: r.workspace, sessionId: r.sessionId }} className="font-medium hover:text-accent-ink">
                {r.title || 'Session sans titre'}
              </Link>
              <p className="text-[13px] text-ink-faint">
                {r.workspaceName}{label ? ` · ${label}` : ''} · {timeAgo(r.endedAt)}
                {length ? ` · ${length}` : ''}{r.costUsd !== null && r.costUsd > 0 ? ` · ${formatCost(r.costUsd)}` : ''}
              </p>
            </div>
            <Tag className={TONE[st.tone]}>{st.text}</Tag>
          </li>
        );
      })}
    </ul>
  );
}
