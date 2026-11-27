// The browser tab tells what Intendia waits for from another tab: its title (« (2) Crons · Intendia » when two
// approvals or questions wait, « • … » while a run or background sub-agents work on the current instance) and a dot
// on the favicon, told apart at 16 px by colour and place: a big red dot at the top right while something waits, a
// smaller blue-black one at the bottom right while working.
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api';
import { useCurrentInstance } from '../instance/current';
import { runMarks } from '../sessions/running';
import { useActivePageValue } from './activePage';
import { useApprovals } from './useApprovals';

export type BadgeKind = 'waiting' | 'running';

/**
 * The favicon's dots on a 64×64 canvas: centre, radius of the white ring and of the coloured dot. Fixed colours: the
 * favicon sits on the browser's tab bar, not on the page.
 */
export const BADGES: Record<BadgeKind, { color: string; x: number; y: number; ring: number; dot: number }> = {
  waiting: { color: '#e5281b', x: 44, y: 20, ring: 20, dot: 15 },
  running: { color: '#1f2937', x: 48, y: 48, ring: 15, dot: 11 },
};
const APP = 'Intendia';
const ICON = '/favicon.svg';

/** `<base> · Intendia` (Intendia alone without base), « (n) » when something waits, else « • » while working. */
export function tabTitle({ base, waiting, running }: { base: string | null; waiting: number; running: boolean }): string {
  const name = base ? `${base} · ${APP}` : APP;
  if (waiting > 0) return `(${waiting}) ${name}`;
  return running ? `• ${name}` : name;
}

/** The favicon's dot: waiting wins over working; null = the plain icon. */
export function badgeKind({ waiting, running }: { waiting: number; running: boolean }): BadgeKind | null {
  if (waiting > 0) return 'waiting';
  return running ? 'running' : null;
}

let image: Promise<HTMLImageElement> | null = null;
function loadIcon(): Promise<HTMLImageElement> {
  image ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = ICON;
  });
  return image;
}

let drawn: BadgeKind | null = null;
/** PNG data URL of each badged icon, drawn once. */
const cache = new Map<BadgeKind, string>();
/** Writes the favicon: the icon with its white-ringed dot, or the plain SVG. */
async function drawBadge(kind: BadgeKind | null): Promise<void> {
  if (kind === drawn) return;
  drawn = kind;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (!kind) {
    link.type = 'image/svg+xml';
    link.href = ICON;
    return;
  }
  try {
    let url = cache.get(kind);
    if (!url) {
      const img = await loadIcon();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const b = BADGES[kind];
      ctx.drawImage(img, 0, 0, 64, 64);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.ring, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.dot, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      url = canvas.toDataURL('image/png');
      cache.set(kind, url);
    }
    if (drawn !== kind) return;
    link.type = 'image/png';
    link.href = url;
  } catch {
    // the icon could not be read: the plain favicon stays
  }
}

/** Keeps the tab's title and favicon up to date; called once, by the layout. `navLabel`: the sidebar entry shown. */
export function useTabStatus(navLabel: string | null): void {
  const { id: inst } = useCurrentInstance();
  const page = useActivePageValue();
  const approvals = useApprovals();
  // shared with the session list (5 s there): the shortest interval of the mounted observers wins
  const activity = useQuery({
    queryKey: ['activity', inst], queryFn: () => api.activity(inst!), enabled: inst !== null,
    refetchInterval: 10_000, refetchIntervalInBackground: true,
  });
  const waiting = approvals.data?.approvals.length ?? 0;
  const running = inst !== null && [...runMarks(activity.data?.runs ?? [], [], inst, activity.data?.subagents ?? []).values()]
    .some((m) => m.state === 'running' || m.state === 'subagents');
  const title = tabTitle({ base: page?.title || navLabel, waiting, running });
  const kind = badgeKind({ waiting, running });
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => { void drawBadge(kind); }, [kind]);
}
