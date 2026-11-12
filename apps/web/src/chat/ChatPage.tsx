import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronDown, Columns3, LayoutGrid, Link2, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../api';
import { Menu } from '../components/Menu';
import { copyText, cx } from '../components/ui';
import { SessionPage, SessionView } from '../pages/Session';
import { useInbox } from '../sessions/InboxLayout';
import { ColumnContext, type Column } from './column-context';
import {
  activate, close, fromAvec, loadChat, MAX, move, openHere, replaceIn, setLayout, setWidth, toAvec, updateChat, useChat,
  type Chat, type ChatLayout, type Col,
} from './columns';
import { EMBEDDED } from './embed';

interface Report { running: boolean; waiting: boolean; title: string }

/** Narrower than this, one chat at a time whatever the layout kept. */
function usePhone(): boolean {
  const q = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

const sessionPath = (c: Col) => ({ to: '/w/$slug/s/$sessionId', params: { slug: c.slug, sessionId: c.id } });

/**
 * The Chat page (address of a session): tabs of the chats open in this browser tab, then one, several side by side
 * or a 2 × 2 grid of sessions (chat/columns.ts). The address names the active chat; the side chat's frame shows the
 * session alone and never touches the columns.
 */
export function ChatPage() {
  if (EMBEDDED) return <SessionPage />;
  return <ChatColumns />;
}

function ChatColumns() {
  const { slug, sessionId } = useParams({ strict: false }) as { slug: string; sessionId: string };
  const { avec } = useSearch({ strict: false }) as { avec?: string };
  const navigate = useNavigate();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces });
  const inst = workspaces.data?.workspaces.find((w) => w.slug === slug)?.instanceId ?? null;
  const stored = useChat(inst);
  const here = useMemo(() => ({ slug, id: sessionId }), [slug, sessionId]);
  // shown at once, before the stored state takes the address's session
  const chat: Chat = useMemo(() => openHere(stored, here), [stored, here]);
  const { full, setFull } = useInbox();
  const phone = usePhone();
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), staleTime: 5_000 });
  const [reports, setReports] = useState<Record<string, Report>>({});

  // The address: the session it names becomes the active chat; a copied link (?avec=) replaces the tab's chats
  useEffect(() => {
    if (!inst || !workspaces.data) return;
    const mine = new Set(workspaces.data.workspaces.filter((w) => w.instanceId === inst).map((w) => w.slug));
    if (avec !== undefined) {
      const others = fromAvec(avec).filter((c) => mine.has(c.slug) && c.id !== here.id);
      const open = [here, ...others].slice(0, MAX);
      updateChat(inst, (c) => ({ ...c, open, active: here.id, layout: open.length > 1 ? (c.layout === 'one' ? 'cols' : c.layout) : 'one', widths: {} }));
      void navigate({ ...sessionPath(here), search: {}, replace: true } as never);
      return;
    }
    updateChat(inst, (c) => {
      const kept = c.open.filter((x) => mine.has(x.slug));
      const base = kept.length === c.open.length ? c : { ...c, open: kept, active: kept.some((x) => x.id === c.active) ? c.active : kept[0]?.id ?? null };
      return openHere(base, here);
    });
  }, [inst, workspaces.data, here, avec, navigate]);

  // what the columns do, through refs so the contexts stay stable
  const latest = useRef({ inst, here, navigate });
  latest.current = { inst, here, navigate };

  const go = useCallback((c: Col | null, replace = true) => {
    const { navigate: nav } = latest.current;
    if (c) void nav({ ...sessionPath(c), replace } as never);
    else void nav({ to: '/' });
  }, []);

  const focus = useCallback((id: string) => {
    const { inst: i, here: h } = latest.current;
    if (!i || id === h.id) return;
    const target = loadChat(i).open.find((x) => x.id === id);
    if (!target) return;
    updateChat(i, (c) => activate(c, id));
    go(target);
  }, [go]);

  const closeCol = useCallback((id: string, emptyTo?: string) => {
    const { inst: i, here: h, navigate: nav } = latest.current;
    if (!i) return;
    const next = updateChat(i, (c) => close(c, id));
    if (id !== h.id) return;
    const active = next.open.find((x) => x.id === next.active) ?? null;
    if (active) go(active);
    else if (emptyTo) void nav({ to: '/w/$slug', params: { slug: emptyTo } });
    else go(null);
  }, [go]);

  const replaceCol = useCallback((from: string, col: Col) => {
    const { inst: i, here: h } = latest.current;
    if (!i) { go(col, false); return; }
    const r = replaceIn(loadChat(i), from, col);
    if (!r) { go(col, false); return; }
    updateChat(i, () => r);
    if (from === h.id) go(r.open.find((x) => x.id === r.active) ?? col, false);
  }, [go]);

  const report = useCallback((id: string, r: Report) => {
    setReports((all) => {
      const old = all[id];
      return old && old.running === r.running && old.waiting === r.waiting && old.title === r.title ? all : { ...all, [id]: r };
    });
  }, []);

  const change = useCallback((f: (c: Chat) => Chat) => { if (latest.current.inst) updateChat(latest.current.inst, f); }, []);

  const layout: ChatLayout = phone ? 'one' : chat.layout;
  const visible = (id: string) => layout !== 'one' || id === sessionId;
  const shown = chat.open.filter((x) => visible(x.id));
  const waitingFeed = new Set((approvals.data?.approvals ?? []).map((a) => a.sessionId));

  const copyLink = () => {
    const others = chat.open.filter((x) => x.id !== sessionId);
    const url = `${window.location.origin}/w/${encodeURIComponent(slug)}/s/${encodeURIComponent(sessionId)}${others.length ? `?avec=${toAvec(others)}` : ''}`;
    void copyText(url, 'Lien des chats ouverts');
  };

  return (
    <div className="flex h-[calc(100dvh-3.75rem-env(safe-area-inset-bottom))] min-h-0 flex-col md:h-[var(--content-h)]" data-chat-page>
      <div role="tablist" aria-label="Chats ouverts" className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line px-2">
        <button type="button" onClick={() => setFull(!full)} aria-pressed={!full}
          title={full ? 'Afficher la liste' : 'Replier la liste'} aria-label={full ? 'Afficher la liste' : 'Replier la liste'}
          className="hidden size-8 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-raised hover:text-ink md:grid">
          {full ? <PanelLeftOpen className="size-4" strokeWidth={1.5} /> : <PanelLeftClose className="size-4" strokeWidth={1.5} />}
        </button>
        {chat.open.map((c, i) => {
          const r = reports[c.id];
          const waiting = Boolean(r?.waiting) || waitingFeed.has(c.id);
          const on = c.id === sessionId;
          return (
            <div key={c.id} data-chat-tab={c.id} className={cx(
              'flex h-8 min-w-0 max-w-[220px] shrink-0 items-center rounded-lg border text-[13px]',
              on ? 'border-ink bg-sheet' : 'border-line bg-paper text-ink-soft hover:text-ink',
            )}>
              <button type="button" role="tab" aria-selected={on} onClick={() => focus(c.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2.5 pr-1">
                <span aria-hidden data-state={waiting ? 'waiting' : r?.running ? 'running' : 'idle'}
                  className={cx('size-[7px] shrink-0 rounded-full', waiting ? 'bg-bad' : r?.running ? 'bg-accent' : 'bg-line')} />
                <span className="truncate">{r?.title ?? '…'}</span>
                {waiting && <span className="sr-only">(attend votre réponse)</span>}
                {!waiting && r?.running && <span className="sr-only">(en cours)</span>}
              </button>
              <Menu title={`Options du chat ${i + 1}`} triggerClass="grid size-6 place-items-center rounded text-ink-faint hover:text-ink"
                trigger={<ChevronDown className="size-3.5" strokeWidth={1.5} />}
                items={[
                  { label: 'Afficher seul', icon: <Square className="size-4" strokeWidth={1.5} />, onSelect: () => { change((x) => setLayout(activate(x, c.id), 'one')); focus(c.id); } },
                  { label: 'Déplacer à gauche', disabled: i === 0, onSelect: () => change((x) => move(x, c.id, -1)) },
                  { label: 'Déplacer à droite', disabled: i === chat.open.length - 1, onSelect: () => change((x) => move(x, c.id, 1)) },
                ]} />
              <button type="button" onClick={() => closeCol(c.id)} aria-label={`Fermer ${r?.title ?? 'ce chat'}`} title="Fermer"
                className="mr-1 grid size-6 shrink-0 place-items-center rounded text-ink-faint hover:bg-raised hover:text-ink">
                <X className="size-3.5" strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          <div className="hidden items-center gap-1 md:flex" role="group" aria-label="Disposition">
            {([['one', 'Un seul', Square], ['cols', 'Colonnes', Columns3], ['grid', 'Grille', LayoutGrid]] as const).map(([l, label, Icon]) => (
              <button key={l} type="button" aria-pressed={chat.layout === l} onClick={() => change((x) => setLayout(x, l))} title={label} aria-label={label}
                className={cx('grid size-8 place-items-center rounded-lg border', chat.layout === l ? 'border-ink text-ink' : 'border-transparent text-ink-faint hover:bg-raised hover:text-ink')}>
                <Icon className="size-4" strokeWidth={1.5} />
              </button>
            ))}
          </div>
          <button type="button" onClick={copyLink} title="Copier le lien des chats ouverts" aria-label="Copier le lien des chats ouverts"
            className="grid size-8 place-items-center rounded-lg text-ink-faint hover:bg-raised hover:text-ink">
            <Link2 className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className={cx(
        'relative min-h-0 flex-1',
        layout === 'cols' && 'flex overflow-x-auto',
        layout === 'grid' && cx('grid grid-cols-2', shown.length > 2 ? 'grid-rows-2' : 'grid-rows-1', shown.length === 1 && 'grid-cols-1'),
      )}>
        {chat.open.map((c) => (
          <ChatColumn key={c.id} col={c} active={c.id === sessionId} layout={layout} visible={visible(c.id)}
            spanAll={layout === 'grid' && shown.length === 3 && shown[2]?.id === c.id}
            many={shown.length > 1} width={chat.widths[c.id]}
            onFocus={focus} onClose={closeCol} onReplace={replaceCol} onReport={report}
            onWidth={(px) => change((x) => setWidth(x, c.id, px))} />
        ))}
      </div>
    </div>
  );
}

function ChatColumn({ col, active, layout, visible, spanAll, many, width, onFocus, onClose, onReplace, onReport, onWidth }: {
  col: Col; active: boolean; layout: ChatLayout; visible: boolean; spanAll: boolean; many: boolean; width?: number;
  onFocus: (id: string) => void; onClose: (id: string, emptyTo?: string) => void; onReplace: (from: string, col: Col) => void;
  onReport: (id: string, r: Report) => void; onWidth: (px: number | null) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const wide = !many;
  const ctx: Column = useMemo(() => ({
    id: col.id, active, wide,
    activate: () => onFocus(col.id),
    close: () => onClose(col.id, col.slug),
    replace: (slug, id, from) => onReplace(from ?? col.id, { slug, id }),
    report: (r) => onReport(col.id, r),
  }), [col.id, col.slug, active, wide, onFocus, onClose, onReplace, onReport]);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = box.width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let w = w0;
    const moveTo = (ev: PointerEvent) => { w = Math.max(300, w0 + ev.clientX - x0); setDrag(w); };
    const up = () => {
      el.removeEventListener('pointermove', moveTo);
      el.removeEventListener('pointerup', up);
      setDrag(null);
      if (w !== w0) onWidth(w);
    };
    el.addEventListener('pointermove', moveTo);
    el.addEventListener('pointerup', up);
  };

  const px = drag ?? width;
  const style: CSSProperties | undefined = layout === 'cols' && visible ? (px ? { flex: '0 0 auto', width: px } : { flex: '1 1 0' }) : undefined;
  return (
    <section ref={ref} aria-label={`Chat ${col.id}`} data-chat-column={col.id} data-active={active || undefined}
      inert={!visible} style={style}
      onPointerDownCapture={() => { if (!active) onFocus(col.id); }}
      onFocusCapture={() => { if (!active) onFocus(col.id); }}
      className={cx(
        'relative min-h-0 min-w-0 overflow-hidden bg-sheet',
        !visible ? 'invisible absolute inset-0' : 'h-full',
        visible && layout === 'cols' && 'min-w-[300px] border-r border-line last:border-r-0',
        visible && layout === 'grid' && 'border-b border-r border-line',
        spanAll && 'col-span-2',
        many && active && 'shadow-[inset_0_2px_0_var(--color-accent)]',
      )}>
      <ColumnContext.Provider value={ctx}>
        <SessionView key={col.id} slug={col.slug} sessionId={col.id} />
      </ColumnContext.Provider>
      {layout === 'cols' && visible && many && (
        <div role="separator" aria-orientation="vertical" aria-label="Largeur du chat" title="Glisser pour régler la largeur, double-clic pour revenir"
          onPointerDown={startResize} onDoubleClick={() => onWidth(null)}
          className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize hover:bg-accent/40" />
      )}
    </section>
  );
}
