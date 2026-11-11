import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useCurrentInstance } from '../instance/current';
import { flatItems, moveIndex, paletteGroups, SEARCH_MIN, type PaletteItem, type PaletteSources } from './palette';
import { cx } from './ui';

/** "⌘ K" on a Mac, else "Ctrl K". */
export const shortcutLabel = (): string => (typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac') ? '⌘ K' : 'Ctrl K');

/** Search box over every page: actions, pages, workspaces, crons, sessions (the server searches the history). */
export function CommandPalette({ nav, onClose }: { nav: PaletteSources['nav']; onClose: () => void }) {
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const { id: inst } = useCurrentInstance();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const crons = useQuery({ queryKey: ['crons-overview'], queryFn: () => api.cronsOverview(), staleTime: 60_000 });
  const recent = useQuery({ queryKey: ['sessions-recent', inst], queryFn: () => api.recentSessions(inst!, 20), enabled: inst !== null, staleTime: 60_000 });
  const searching = q.length >= SEARCH_MIN && text.trim() === q;
  const found = useQuery({
    queryKey: ['sessions-search', inst, 'all', q], queryFn: () => api.searchSessions(inst!, q, 'all'), enabled: q.length >= SEARCH_MIN && inst !== null,
  });

  const groups = useMemo(() => paletteGroups(text, {
    nav,
    workspaces: (workspaces.data?.workspaces ?? []).filter((w) => w.instanceId === inst),
    crons: (crons.data?.crons ?? []).filter((c) => c.instanceId === inst),
    recent: recent.data?.sessions ?? [],
    found: searching ? found.data?.sessions ?? null : null,
  }), [text, nav, inst, workspaces.data, crons.data, recent.data, searching, found.data]);
  const items = flatItems(groups);
  useEffect(() => setIndex(0), [text]);
  const current = items[Math.min(index, items.length - 1)];

  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (current) document.getElementById(`${id}-${current.id}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, id]);

  const go = (item: PaletteItem) => {
    onClose();
    void navigate(item.target as never);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => moveIndex(Math.min(i, items.length - 1), e.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      go(current);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const partial = searching ? found.data?.partial ?? [] : [];
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/25 px-3 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Rechercher" onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[14px] border border-line bg-sheet shadow-[0_24px_64px_rgb(22_24_27/0.18)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={1.5} aria-hidden />
          <input
            ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={current ? `${id}-${current.id}` : undefined}
            placeholder="Rechercher une page, un workspace, un cron, une session…"
            className="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-faint"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 font-mono text-[11px] text-ink-faint">Échap</kbd>
        </div>
        <div id={`${id}-list`} role="listbox" aria-label="Résultats" className="min-h-0 flex-1 overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.id} role="group" aria-labelledby={`${id}-g-${g.id}`} className="pb-1">
              <p id={`${id}-g-${g.id}`} className="px-2.5 pb-1 pt-2 text-xs font-medium text-ink-faint">{g.label}</p>
              {g.items.map((item) => (
                <div
                  key={item.id} id={`${id}-${item.id}`} role="option" aria-selected={item === current}
                  onMouseMove={() => setIndex(items.indexOf(item))} onClick={() => go(item)}
                  className={cx('flex cursor-pointer items-baseline gap-3 rounded-lg px-2.5 py-2 text-sm', item === current ? 'bg-raised text-ink' : 'text-ink-soft')}
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.label}</span>
                  {item.hint && <span className="max-w-[45%] shrink-0 truncate text-xs text-ink-faint">{item.hint}</span>}
                </div>
              ))}
            </div>
          ))}
          {items.length === 0 && (
            <p className="px-2.5 py-6 text-center text-sm text-ink-soft">
              {q.length >= SEARCH_MIN && (found.isFetching || !searching) ? 'Recherche…' : 'Aucun résultat'}
            </p>
          )}
          {items.length > 0 && q.length >= SEARCH_MIN && found.isFetching && <p className="px-2.5 py-1 text-xs text-ink-faint">Recherche dans les sessions…</p>}
          {partial.map((name) => (
            <p key={name} className="px-2.5 py-1 text-xs text-ink-faint">Sur {name}, seuls les titres des sessions Intendia sont cherchés</p>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
