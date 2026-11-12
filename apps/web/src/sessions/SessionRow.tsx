import { Columns2 } from 'lucide-react';
import type { RecentSession } from '../api';
import { ListItemBody, ListLink } from '../components/Panes';
import { Tag } from '../components/ui';
import { sourceLabel } from '../home/labels';
import { splitMarks } from './marks';

/** The hour within the day ("14:05"), else the date ("9 nov."). */
function when(at: number, now = Date.now()): string {
  if (!at) return '';
  const d = new Date(at);
  if (d.toDateString() === new Date(now).toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** The search hit under the title, the found words in bold (text nodes only, never HTML). */
export function Snippet({ text }: { text: string }) {
  return (
    <span data-snippet>
      {splitMarks(text.replace(/\s+/g, ' ')).map((p, i) => (p.hit ? <strong key={i} className="font-semibold text-ink">{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

/** One session of the inbox column: title, time, workspace or search hit, source tag; highlighted when open. */
export function SessionRow({ s, open, onBeside }: { s: RecentSession; open: boolean; onBeside?: (slug: string, id: string) => void }) {
  const link: { to: string; params: Record<string, string> } = s.kind === 'intendia' && s.workspace
    ? { to: '/w/$slug/s/$sessionId', params: { slug: s.workspace, sessionId: s.id } }
    : { to: '/i/$inst/p/$profile/s/$sessionId', params: { inst: s.instanceId, profile: s.profile, sessionId: s.id } };
  // Chat page: another column (Ctrl/Cmd + click, or the button shown on hover); the middle click keeps the browser's tab
  const ws = s.kind === 'intendia' ? s.workspace : null;
  const beside = onBeside && ws ? () => onBeside(ws, s.id) : null;
  return (
    <li data-recent={s.source ?? 'hermes'} className={beside ? 'group relative' : undefined}>
      <ListLink link={link} selected={open}
        onClick={beside ? (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); beside(); } } : undefined}>
        <ListItemBody
          title={s.title}
          meta={when(s.at)}
          sub={s.snippet ? <Snippet text={s.snippet} /> : s.sub}
          tag={<Tag className={open ? 'bg-sheet' : undefined}>{sourceLabel(s.source).toLowerCase()}</Tag>}
        />
      </ListLink>
      {beside && (
        <button type="button" onClick={beside} aria-label="Ouvrir à côté" title="Ouvrir à côté (Ctrl + clic)"
          className="absolute bottom-2 right-3 hidden items-center gap-1 rounded-md border border-line bg-sheet px-1.5 py-0.5 text-[11.5px] text-ink-soft shadow-sm hover:text-ink md:group-hover:flex md:group-focus-within:flex">
          <Columns2 className="size-3.5" strokeWidth={1.5} />
          À côté
        </button>
      )}
    </li>
  );
}
