import { Columns2, Trash2 } from 'lucide-react';
import type { RecentSession } from '../api';
import type { RunState } from './running';
import { ListItemBody, ListLink } from '../components/Panes';
import { cx, Tag } from '../components/ui';
import { sourceLabel } from '../home/labels';
import { splitMarks } from './marks';
import { locale, plural, t } from '../i18n';

/** The hour within the day ("14:05"), else the date ("9 nov."). */
function when(at: number, now = Date.now()): string {
  if (!at) return '';
  const d = new Date(at);
  if (d.toDateString() === new Date(now).toDateString()) return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/** The search hit under the title, the found words in bold (text nodes only, never HTML). */
export function Snippet({ text }: { text: string }) {
  return (
    <span data-snippet>
      {splitMarks(text.replace(/\s+/g, ' ')).map((p, i) => (p.hit ? <strong key={i} className="font-semibold text-ink">{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/** « 2 sous-agents » */
export const subagentsLabel = (n: number | undefined): string => plural(n ?? 0, '{n} sous-agent', '{n} sous-agents');

/** Where the agent stands, in place of the time: working (pulsing), its sub-agents working, or waiting for the user. */
function RunBadge({ run, subagents }: { run: RunState; subagents?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-medium text-ink">
      <span className={run === 'waiting' ? 'size-2 rounded-full bg-bad' : 'size-2 animate-pulse rounded-full bg-accent'} />
      {run === 'waiting' ? t('Attend votre réponse') : run === 'subagents' ? subagentsLabel(subagents) : t('En cours')}
    </span>
  );
}

/**
 * One session of the inbox column: title, time, workspace or search hit, source tag; highlighted when open, tinted
 * with the agent's state while it works (`run`).
 */
export function SessionRow({ s, open, onBeside, run, subagents, onRemove, busy }: {
  s: RecentSession; open: boolean; onBeside?: (slug: string, id: string) => void; run?: RunState;
  /** run `subagents`: how many work */
  subagents?: number;
  /** the trash shown on hover (disabled while the agent works or the deletion runs: `busy`) */
  onRemove?: () => void;
  busy?: boolean;
}) {
  const link: { to: string; params: Record<string, string> } = s.kind === 'intendia' && s.workspace
    ? { to: '/w/$slug/s/$sessionId', params: { slug: s.workspace, sessionId: s.id } }
    : { to: '/i/$inst/p/$profile/s/$sessionId', params: { inst: s.instanceId, profile: s.profile, sessionId: s.id } };
  // Chat page: another column (Ctrl/Cmd + click, or the button shown on hover); the middle click keeps the browser's tab
  const ws = s.kind === 'intendia' ? s.workspace : null;
  const beside = onBeside && ws ? () => onBeside(ws, s.id) : null;
  return (
    <li data-recent={s.source ?? 'hermes'} data-run={run} className={cx('group relative', run && !open && 'rounded-[10px] bg-accent-soft/40')}>
      <ListLink link={link} selected={open}
        onClick={beside ? (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); beside(); } } : undefined}>
        <ListItemBody
          title={s.title}
          // the trash takes the place of the time on hover
          meta={<span className={onRemove ? 'md:group-hover:invisible md:group-focus-within:invisible' : undefined}>{run ? <RunBadge run={run} subagents={subagents} /> : when(s.at)}</span>}
          sub={s.snippet ? <Snippet text={s.snippet} /> : s.sub}
          tag={<Tag className={open ? 'bg-sheet' : undefined}>{sourceLabel(s.source).toLowerCase()}</Tag>}
        />
      </ListLink>
      {beside && (
        <button type="button" onClick={beside} aria-label={t('Ouvrir à côté')} title={t('Ouvrir à côté (Ctrl + clic)')}
          className="absolute bottom-2 right-3 hidden items-center gap-1 rounded-md border border-line bg-sheet px-1.5 py-0.5 text-[11.5px] text-ink-soft shadow-sm hover:text-ink md:group-hover:flex md:group-focus-within:flex">
          <Columns2 className="size-3.5" strokeWidth={1.5} />
          {t('À côté')}
        </button>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={Boolean(run) || busy} aria-label={t('Supprimer la session {title}', { title: s.title })}
          title={run ? t('L’agent travaille : attendez la fin pour supprimer') : t('Supprimer')}
          className="absolute right-3 top-2 hidden rounded-md border border-line bg-sheet p-1 text-ink-soft shadow-sm hover:text-bad disabled:opacity-50 disabled:hover:text-ink-soft md:group-hover:flex md:group-focus-within:flex">
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      )}
    </li>
  );
}
