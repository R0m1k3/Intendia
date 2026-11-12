import type { FileEntry, OverviewCron, RecentSession } from '../api';
import { matchesAll, wordsOf } from './text';

/** Where an item leads: options for the router's `navigate`. */
export interface Target { to: string; params?: Record<string, string>; search?: Record<string, unknown> }
export type PaletteGroupId = 'actions' | 'pages' | 'workspaces' | 'crons' | 'sessions' | 'files';
export type PaletteMode = 'all' | 'files';
/** `target`: where it leads; an item with `mode` switches the palette instead (« Ouvrir un fichier… »). */
export interface PaletteItem { id: string; label: string; hint?: string; target?: Target; mode?: PaletteMode }
export interface PaletteGroup { id: PaletteGroupId; label: string; items: PaletteItem[] }

export const PER_GROUP = 5;
/** Text length from which the sessions come from the server's search. */
export const SEARCH_MIN = 2;

const GROUP_LABEL: Record<PaletteGroupId, string> = {
  actions: 'Actions', pages: 'Pages', workspaces: 'Workspaces', crons: 'Crons', sessions: 'Sessions', files: 'Fichiers',
};

export const ACTIONS: PaletteItem[] = [
  { id: 'a:new-session', label: 'Nouvelle session', target: { to: '/chat/nouvelle' } },
  { id: 'a:new-workspace', label: 'Nouveau workspace', target: { to: '/w' } },
  { id: 'a:files', label: 'Ouvrir un fichier…', mode: 'files' },
];

/** Results shown in the « Fichiers » mode of the palette. */
export const FILES_MAX = 50;

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * A path of the instance's file root → the page that shows it: the workspace's Fichiers page when its first segment
 * is a workspace of this instance, else the instance's Fichiers page. A folder opens, a file opens in the preview.
 */
export function fileTarget(inst: string, path: string, workspaces: readonly { slug: string }[], dir = false): Target {
  const seg = path.split('/')[0]!;
  if (path.includes('/') && workspaces.some((w) => w.slug === seg)) {
    const rel = path.slice(seg.length + 1);
    const search = dir ? { path: rel } : { path: parentOf(rel) || undefined, f: rel };
    return { to: '/w/$slug/fichiers', params: { slug: seg }, search };
  }
  return { to: '/i/$inst/files', params: { inst }, search: dir ? { path } : { path: parentOf(path) || undefined, f: path } };
}

/** The instance search's results as palette items (name, folder). */
export function fileItems(inst: string, results: readonly FileEntry[], workspaces: readonly { slug: string }[]): PaletteItem[] {
  return results.slice(0, FILES_MAX).map((e) => ({
    id: `f:${e.path}`, label: e.name, hint: parentOf(e.path) || '/',
    target: fileTarget(inst, e.path, workspaces, e.kind === 'dir'),
  }));
}

export function sessionTarget(s: RecentSession): Target {
  return s.kind === 'intendia' && s.workspace
    ? { to: '/w/$slug/s/$sessionId', params: { slug: s.workspace, sessionId: s.id } }
    : { to: '/i/$inst/p/$profile/s/$sessionId', params: { inst: s.instanceId, profile: s.profile, sessionId: s.id } };
}

export interface PaletteSources {
  /** Pages, their target already resolved for the current instance. */
  nav: readonly { key: string; label: string; target: Target }[];
  workspaces: readonly { slug: string; name: string }[];
  crons: readonly OverviewCron[];
  /** The home page's recent sessions (shown without text). */
  recent: readonly RecentSession[];
  /** The server's search for the current text (SEARCH_MIN characters or more), when it has answered. */
  found: readonly RecentSession[] | null;
}

/** Groups shown for a text: without text, actions, pages and the latest sessions; else every match, 5 per group. */
export function paletteGroups(q: string, src: PaletteSources): PaletteGroup[] {
  const words = wordsOf(q);
  const keep = (items: PaletteItem[]) => (words.length ? items.filter((i) => matchesAll(words, `${i.label} ${i.hint ?? ''}`)) : items);
  const pages: PaletteItem[] = src.nav.map((n) => ({ id: `p:${n.key}`, label: n.label, target: n.target }));
  const toSession = (s: RecentSession): PaletteItem => ({ id: `s:${s.instanceId}:${s.id}`, label: s.title, hint: s.sub, target: sessionTarget(s) });
  let sessions: PaletteItem[];
  if (!words.length) sessions = src.recent.map(toSession);
  else if (q.trim().length >= SEARCH_MIN) sessions = (src.found ?? []).map(toSession);
  else sessions = keep(src.recent.map(toSession));
  const groups: [PaletteGroupId, PaletteItem[]][] = words.length
    ? [
        ['actions', keep(ACTIONS)],
        ['pages', keep(pages)],
        ['workspaces', keep(src.workspaces.map((w) => ({ id: `w:${w.slug}`, label: w.name, hint: w.slug, target: { to: '/w/$slug', params: { slug: w.slug } } })))],
        ['crons', keep(src.crons.map((c) => ({ id: `c:${c.instanceId}:${c.id}`, label: c.name, target: { to: '/i/$inst/crons', params: { inst: c.instanceId } } })))],
        ['sessions', sessions],
      ]
    : [['actions', ACTIONS], ['pages', pages], ['sessions', sessions]];
  return groups
    .map(([id, items]) => ({ id, label: GROUP_LABEL[id], items: items.slice(0, PER_GROUP) }))
    .filter((g) => g.items.length > 0);
}

/** The items in display order (for the keyboard). */
export const flatItems = (groups: PaletteGroup[]): PaletteItem[] => groups.flatMap((g) => g.items);

/** Next index for ↑ (-1) or ↓ (+1), wrapping around; -1 when there is nothing. */
export function moveIndex(index: number, delta: number, count: number): number {
  if (count === 0) return -1;
  return (((index + delta) % count) + count) % count;
}
