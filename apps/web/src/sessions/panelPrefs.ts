// The session's side panel (OpenBot-like): its tab and its width, kept per session in this browser, so a session
// reopens with the panel as it was left. Pure helpers (panelPrefs.test.ts) + localStorage access.

export type PanelTab = 'files' | 'subagents' | 'aside' | 'agent';

export interface PanelPrefs { tab: PanelTab; width: number }

export const PANEL_MIN = 300;
export const PANEL_MAX = 720;
export const PANEL_DEFAULT: PanelPrefs = { tab: 'files', width: 380 };
/** Kept sessions: the oldest go first. */
export const PANEL_KEEP = 200;

const KEY = 'intendia-panel';
const TABS: PanelTab[] = ['files', 'subagents', 'aside', 'agent'];

export const clampWidth = (w: number) => Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)));

type Store = Record<string, PanelPrefs & { at: number }>;

export function parseStore(raw: string | null): Store {
  try {
    const v = raw ? JSON.parse(raw) as unknown : null;
    if (!v || typeof v !== 'object') return {};
    const out: Store = {};
    for (const [id, p] of Object.entries(v as Record<string, Partial<PanelPrefs & { at: number }>>)) {
      if (!p || !TABS.includes(p.tab as PanelTab) || typeof p.width !== 'number') continue;
      out[id] = { tab: p.tab as PanelTab, width: clampWidth(p.width), at: typeof p.at === 'number' ? p.at : 0 };
    }
    return out;
  } catch { return {}; }
}

/** The store with `id` set to `prefs`, the oldest sessions dropped past PANEL_KEEP. */
export function withPrefs(store: Store, id: string, prefs: PanelPrefs, now: number): Store {
  const all = Object.entries({ ...store, [id]: { tab: prefs.tab, width: clampWidth(prefs.width), at: now } });
  return Object.fromEntries(all.sort((a, b) => b[1].at - a[1].at).slice(0, PANEL_KEEP));
}

export function readPanel(id: string): PanelPrefs {
  const p = parseStore(localStorage.getItem(KEY))[id];
  return p ? { tab: p.tab, width: p.width } : PANEL_DEFAULT;
}

export function savePanel(id: string, prefs: PanelPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(withPrefs(parseStore(localStorage.getItem(KEY)), id, prefs, Date.now()))); } catch { /* full: not kept */ }
}
