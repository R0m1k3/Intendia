// Chats open side by side on the Chat page, per browser tab, sessions of any instance (a column's instance is its
// workspace's). The tab's value lives in sessionStorage (`intendia-chat`), copied to localStorage on each write: a new
// tab starts from the copy, a tab never changes another one's columns (as instance/current.ts). A session is never in
// two columns, and session ids are unique across instances (`iw-<slug>-…`), so a session id names its column.

import { useSyncExternalStore } from 'react';

export type ChatLayout = 'one' | 'cols' | 'grid';
export interface Col { slug: string; id: string }
export interface Chat { open: Col[]; active: string | null; layout: ChatLayout; widths: Record<string, number> }

export const EMPTY: Chat = { open: [], active: null, layout: 'one', widths: {} };
export const MAX = 4;

const has = (c: Chat, id: string) => c.open.some((x) => x.id === id);
const indexOf = (c: Chat, id: string | null) => (id === null ? -1 : c.open.findIndex((x) => x.id === id));

function withoutWidth(widths: Record<string, number>, id: string): Record<string, number> {
  if (!(id in widths)) return widths;
  const { [id]: _gone, ...rest } = widths;
  return rest;
}

/** Puts `col` in place of the column `at`, its width carried over. */
function swap(c: Chat, at: number, col: Col): Chat {
  const old = c.open[at]!;
  const open = c.open.map((x, i) => (i === at ? col : x));
  let widths = withoutWidth(c.widths, old.id);
  if (old.id in c.widths) widths = { ...widths, [col.id]: c.widths[old.id]! };
  return { ...c, open, widths, active: c.active === old.id ? col.id : c.active };
}

/** Opens in the active column (or as the first one); an open session is made active. */
export function openHere(c: Chat, col: Col): Chat {
  if (has(c, col.id)) return activate(c, col.id);
  const at = indexOf(c, c.active);
  if (at < 0) return c.open.length ? { ...c, open: [...c.open, col], active: col.id } : { ...c, open: [col], active: col.id };
  return { ...swap(c, at, col), active: col.id };
}

/** Opens in a new column right of the active one (in its place when MAX are open); leaves « Une » for « Colonnes ». */
export function openBeside(c: Chat, col: Col): Chat {
  if (has(c, col.id)) return { ...c, active: col.id };
  if (c.open.length >= MAX) return openHere(c, col);
  const at = indexOf(c, c.active);
  const open = [...c.open];
  open.splice(at < 0 ? open.length : at + 1, 0, col);
  return { ...c, open, active: col.id, layout: c.layout === 'one' && open.length > 1 ? 'cols' : c.layout };
}

/**
 * The column of `fromId` now shows `col` (a branch, a copy, `/new`…). null when `fromId` is no longer open (closed
 * meanwhile: the caller navigates instead). `col` already open elsewhere: that column is made active, `fromId` kept.
 * The same session with another workspace (a move): the column follows it.
 */
export function replaceIn(c: Chat, fromId: string, col: Col): Chat | null {
  const at = indexOf(c, fromId);
  if (at < 0) return null;
  // the same session in another workspace (moved): the column keeps its place, width and active mark
  if (col.id === fromId) return c.open[at]!.slug === col.slug ? c : { ...c, open: c.open.map((x, i) => (i === at ? col : x)) };
  if (has(c, col.id)) return { ...c, active: col.id };
  return swap(c, at, col);
}

/** Closes a column; the active one hands over to its right neighbour, else its left one. */
export function close(c: Chat, id: string): Chat {
  const at = indexOf(c, id);
  if (at < 0) return c;
  const open = c.open.filter((x) => x.id !== id);
  const active = c.active !== id ? c.active : (open[at] ?? open[at - 1])?.id ?? null;
  return { ...c, open, active, widths: withoutWidth(c.widths, id) };
}

export function activate(c: Chat, id: string): Chat {
  return has(c, id) && c.active !== id ? { ...c, active: id } : c;
}

export function move(c: Chat, id: string, dir: -1 | 1): Chat {
  const at = indexOf(c, id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= c.open.length) return c;
  const open = [...c.open];
  [open[at], open[to]] = [open[to]!, open[at]!];
  return { ...c, open };
}

export function setLayout(c: Chat, layout: ChatLayout): Chat {
  return c.layout === layout ? c : { ...c, layout };
}

/** null: back to the default (equal) width. */
export function setWidth(c: Chat, id: string, px: number | null): Chat {
  if (!has(c, id)) return c;
  return { ...c, widths: px === null ? withoutWidth(c.widths, id) : { ...c.widths, [id]: Math.round(px) } };
}

/** `?avec=` of a copied link: the other columns, `slug:id` URI-encoded, comma separated. */
export function toAvec(cols: readonly Col[]): string {
  return cols.map((x) => `${encodeURIComponent(x.slug)}:${encodeURIComponent(x.id)}`).join(',');
}

export function fromAvec(s: string): Col[] {
  const out: Col[] = [];
  for (const part of s.split(',')) {
    const [a, b, ...rest] = part.split(':');
    if (!a || !b || rest.length) continue;
    let col: Col;
    try { col = { slug: decodeURIComponent(a), id: decodeURIComponent(b) }; } catch { continue; }
    if (!col.slug || !col.id || out.some((x) => x.id === col.id)) continue;
    out.push(col);
    if (out.length >= MAX - 1) break;
  }
  return out;
}

/** The sessions whose files panel is open (the list column steps aside while one is). Same set when unchanged. */
export function withPanel(set: ReadonlySet<string>, id: string, open: boolean): ReadonlySet<string> {
  if (set.has(id) === open) return set;
  const next = new Set(set);
  if (open) next.add(id); else next.delete(id);
  return next;
}

// ---- store ----

const KEY = 'intendia-chat';
/** Before every instance shared one state: one key per instance. */
const OLD_PREFIX = 'intendia-chat:';

function parse(raw: string | null): Chat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Chat> | null;
    if (!v || !Array.isArray(v.open)) return null;
    const open = v.open.filter((x): x is Col => !!x && typeof x.slug === 'string' && typeof x.id === 'string' && !!x.slug && !!x.id)
      .filter((x, i, all) => all.findIndex((y) => y.id === x.id) === i).slice(0, MAX);
    const layout: ChatLayout = v.layout === 'cols' || v.layout === 'grid' ? v.layout : 'one';
    const widths: Record<string, number> = {};
    for (const x of open) {
      const w = (v.widths as Record<string, unknown> | undefined)?.[x.id];
      if (typeof w === 'number' && Number.isFinite(w) && w > 0) widths[x.id] = w;
    }
    const active = typeof v.active === 'string' && open.some((x) => x.id === v.active) ? v.active : open[0]?.id ?? null;
    return { open, active, layout, widths };
  } catch {
    return null;
  }
}

const read = (store: Storage | undefined, k: string): string | null => {
  try { return store?.getItem(k) ?? null; } catch { return null; }
};

let cache: Chat | null = null;
let purged = false;
const listeners = new Set<() => void>();

const storages = (): (Storage | undefined)[] => {
  const g = globalThis as { sessionStorage?: Storage; localStorage?: Storage };
  return [g.sessionStorage, g.localStorage];
};

/** The per-instance states of older versions: dropped, not carried over (columns to reopen once). */
function purgeOld(): void {
  if (purged) return;
  purged = true;
  for (const store of storages()) {
    try {
      if (!store) continue;
      const old: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith(OLD_PREFIX)) old.push(k);
      }
      for (const k of old) store.removeItem(k);
    } catch { /* storage blocked */ }
  }
}

/** This tab's chats: sessionStorage, else the copy of the last tab that wrote, else none. */
export function loadChat(): Chat {
  if (cache) return cache;
  purgeOld();
  const [own, shared] = storages();
  cache = parse(read(own, KEY)) ?? parse(read(shared, KEY)) ?? EMPTY;
  return cache;
}

export function updateChat(f: (c: Chat) => Chat): Chat {
  const before = loadChat();
  const next = f(before);
  if (next === before) return before;
  cache = next;
  const raw = JSON.stringify(next);
  const [own, shared] = storages();
  try { own?.setItem(KEY, raw); } catch { /* kept in memory for this page */ }
  try { shared?.setItem(KEY, raw); } catch { /* new tabs start empty */ }
  listeners.forEach((l) => l());
  return next;
}

/** Tests: forget what was read. */
export function resetChatCache(): void {
  cache = null;
  purged = false;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** This tab's chats (EMPTY when not `enabled`), re-rendered on every change. */
export function useChat(enabled = true): Chat {
  return useSyncExternalStore(subscribe, () => (enabled ? loadChat() : EMPTY));
}
