// Side chat (⌘J): the session page runs in an iframe of the same app (`?embed=1`), without the sidebar.
// The two frames talk by postMessage (frame → page) and by the `intendia-sync` BroadcastChannel (sessions lists).

/** This copy of the app is the side chat's iframe: decided once at load (in-app navigation keeps it). */
export const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top
  && new URLSearchParams(window.location.search).has('embed');

/** Message from the iframe to the page: ⌘J pressed inside the side chat. */
export const TOGGLE = 'side-chat-toggle';

/** Tells the page around the iframe that ⌘J was pressed (same origin only). */
export function toggleFromFrame(): void {
  window.parent.postMessage({ type: TOGGLE }, window.location.origin);
}

/** Ctrl/Cmd J without other modifiers. */
export function isSideChatKey(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j';
}

export interface SideSession { slug: string; id: string }

const key = (inst: string) => `intendia-side-session:${inst}`;

/** Session shown by the side chat of an instance: the last session opened (full size or in the side chat). */
export function sideSession(inst: string): SideSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(inst)) ?? 'null') as SideSession | null;
    return v && typeof v.slug === 'string' && typeof v.id === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function setSideSession(inst: string, s: SideSession): void {
  try { localStorage.setItem(key(inst), JSON.stringify(s)); } catch { /* not kept: the side chat starts a new one */ }
}

export function forgetSideSession(inst: string, id: string): void {
  if (sideSession(inst)?.id === id) localStorage.removeItem(key(inst));
}

/** Address of a session in the side chat. */
export function embedUrl(s: SideSession): string {
  return `/w/${encodeURIComponent(s.slug)}/s/${encodeURIComponent(s.id)}?embed=1`;
}
