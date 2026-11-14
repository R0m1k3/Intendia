import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Pin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, type BulkAction, type BulkResult, type Session, type Workspace } from '../api';
import { askChoice } from '../components/Dialog';
import { Button, ErrorText, cx, timeAgo } from '../components/ui';
import { ACTION_LABELS, groupSessions, selectionActions } from './actions';
import { plural, t } from '../i18n';
import { T } from '../i18n/T';
import { SESSION_LIST_KEYS, showUndo } from './UndoBar';

/**
 * Sessions of a workspace grouped (pinned, then per day) with a check box per line and an action bar over the
 * list while something is selected. Actions go through one bulk request; refusals are listed under the bar.
 */
export function SessionSelectList({ workspace, sessions }: { workspace: Workspace; sessions: Session[] }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ title: string; error: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const all = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const actions = selectionActions(sessions, selected);

  // the list changed (archived view, deletion): forget what is no longer shown
  useEffect(() => {
    setSelected((cur) => {
      const ids = new Set(sessions.map((s) => s.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [sessions]);

  const toggle = (ids: string[], on: boolean) => setSelected((cur) => {
    const next = new Set(cur);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });

  const run = async (action: BulkAction) => {
    const ids = [...selected];
    let target: string | undefined;
    if (action === 'move') {
      const options = (all.data?.workspaces ?? [])
        .filter((w) => w.slug !== workspace.slug && w.instanceId === workspace.instanceId && (w.profile ?? 'default') === (workspace.profile ?? 'default'))
        .map((w) => ({ value: w.slug, label: w.name }));
      if (!options.length) {
        setFailures([]);
        setError(new Error(t('Aucun autre workspace pour cet agent : créez-en un d’abord')));
        return;
      }
      const picked = await askChoice({ title: plural(ids.length, 'Déplacer {n} session', 'Déplacer {n} sessions'), label: t('Vers le workspace'), options, confirmLabel: t('Déplacer') });
      if (!picked) return;
      target = picked;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.bulkSessions(workspace.instanceId, ids, action, target);
      const failed = res.results.filter((r): r is BulkResult & { error: string } => !r.ok && Boolean(r.error));
      const titles = new Map(sessions.map((s) => [s.id, s.title || t('Nouvelle session')]));
      setFailures(failed.map((f) => ({ title: titles.get(f.id) ?? f.id, error: f.error })));
      const done = res.results.filter((r) => r.ok).map((r) => r.id);
      if (res.undoUntil && done.length) {
        showUndo({ inst: workspace.instanceId, ids: done, undoUntil: res.undoUntil, label: plural(done.length, '{n} session supprimée', '{n} sessions supprimées') });
      }
      setSelected(new Set(failed.map((f) => f.id)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      await Promise.all(SESSION_LIST_KEYS.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
    }
  };

  return (
    <div>
      {selected.size > 0 && (
        <div data-selection-bar className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-sheet px-5 py-2">
          <span className="mr-auto text-sm font-medium">{plural(selected.size, '{n} session sélectionnée', '{n} sessions sélectionnées')}</span>
          {actions.map((a) => (
            <Button key={a} variant={a === 'delete' ? 'danger' : 'ghost'} className="h-8 text-xs" disabled={busy} onClick={() => void run(a)}>
              {ACTION_LABELS[a]}
            </Button>
          ))}
          <Button variant="ghost" className="h-8 text-xs" onClick={() => setSelected(new Set())}>{t('Désélectionner')}</Button>
        </div>
      )}
      {(failures.length > 0 || error !== null) && (
        <div data-selection-failures className="space-y-1 border-b border-line px-5 py-2 text-sm">
          <ErrorText error={error} />
          {failures.map((f, i) => (
            <p key={i} className="text-bad"><T k="{title} : {error}" vars={{ title: <span className="font-medium">{f.title}</span>, error: f.error }} /></p>
          ))}
        </div>
      )}
      {groups.map((g) => {
        const ids = g.items.map((s) => s.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <section key={g.label} aria-label={g.label}>
            <div className="flex h-9 items-center gap-3 bg-paper px-4 text-xs font-medium text-ink-soft">
              <input type="checkbox" aria-label={t('Tout sélectionner : {label}', { label: g.label })} checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} className="accent-accent" />
              <span>{g.label}</span>
            </div>
            <ul className="divide-y divide-line">
              {g.items.map((s) => (
                <li key={s.id} className={cx('flex h-12 items-center gap-3 pl-4 text-sm transition-colors hover:bg-paper', selected.has(s.id) && 'bg-raised/60')}>
                  <input
                    type="checkbox" aria-label={t('Sélectionner {title}', { title: s.title || t('Nouvelle session') })} checked={selected.has(s.id)}
                    onChange={(e) => toggle([s.id], e.target.checked)} className="accent-accent"
                  />
                  <Link to="/w/$slug/s/$sessionId" params={{ slug: workspace.slug, sessionId: s.id }} className="flex h-full min-w-0 flex-1 items-center gap-2 pr-5">
                    {s.pinned && <Pin className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-label={t('Épinglée')} />}
                    <span className="min-w-0 flex-1 truncate">{s.title || <span className="text-ink-faint">{t('Nouvelle session')}</span>}</span>
                    <span className="shrink-0 text-xs text-ink-faint">{timeAgo(s.lastActiveAt ?? s.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
