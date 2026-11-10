import { Link } from '@tanstack/react-router';
import type { RecentSession } from '../api';
import { cx, timeAgo } from '../components/ui';
import { sourceLabel } from '../home/labels';
import { splitMarks } from './marks';

const TAG: Record<string, string> = {
  intendia: 'bg-accent/10 text-accent',
  telegram: 'bg-ok-soft text-ink',
  cron: 'bg-warn-soft text-ink',
};

/** "il y a 6 h" within a day, else the date ("9 nov."); `time` gives the hour instead ("14:05"). */
function when(at: number, time: boolean, now = Date.now()): string {
  if (!at) return '';
  if (time) return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (now - at < 24 * 3600_000) return timeAgo(at);
  return new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** The search hit under the title, the found words in bold (text nodes only, never HTML). */
export function Snippet({ text }: { text: string }) {
  return (
    <span data-snippet className="mt-0.5 line-clamp-2 text-xs text-ink-soft">
      {splitMarks(text.replace(/\s+/g, ' ')).map((p, i) => (p.hit ? <strong key={i} className="font-semibold text-ink">{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/** One session line (home page, Sessions page): source tag, title, workspace or instance, date. */
export function SessionRow({ s, time = false }: { s: RecentSession; time?: boolean }) {
  const body = (
    <>
      <span className={cx('w-[4.5rem] shrink-0 truncate rounded-md px-1.5 py-0.5 text-center font-mono text-[11px]', TAG[s.source ?? ''] ?? 'bg-raised text-ink-soft')}>
        {sourceLabel(s.source)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{s.title}</span>
        {s.snippet && <Snippet text={s.snippet} />}
        <span className="block truncate text-xs text-ink-faint">{s.sub}</span>
      </span>
      <span className="shrink-0 text-xs text-ink-faint">{when(s.at, time)}</span>
    </>
  );
  const cls = 'flex min-w-0 items-center gap-3 px-5 py-3 transition-colors hover:bg-raised/50';
  return (
    <li data-recent={s.source ?? 'hermes'}>
      {s.kind === 'intendia' && s.workspace ? (
        <Link to="/w/$slug/s/$sessionId" params={{ slug: s.workspace, sessionId: s.id }} className={cls}>{body}</Link>
      ) : (
        <Link to="/i/$inst/p/$profile/s/$sessionId" params={{ inst: s.instanceId, profile: s.profile, sessionId: s.id }} className={cls}>{body}</Link>
      )}
    </li>
  );
}
