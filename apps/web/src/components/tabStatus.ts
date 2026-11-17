// The browser tab tells what Intendia waits for from another tab: its title (« (2) Crons · Intendia » when two
// approvals or questions wait, « • … » while a run or background sub-agents work on the current instance) and a dot
// on the favicon (red: waiting, dark orange: working).
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api';
import { useCurrentInstance } from '../instance/current';
import { runMarks } from '../sessions/running';
import { useActivePageValue } from './activePage';

/** Fixed colours of the light theme: the favicon sits on the browser's tab bar, not on the page. */
export const BADGE_WAITING = '#b42318';
export const BADGE_RUNNING = '#b5480c';
const APP = 'Intendia';
const ICON = '/favicon.svg';

/** `<base> · Intendia` (Intendia alone without base), « (n) » when something waits, else « • » while working. */
export function tabTitle({ base, waiting, running }: { base: string | null; waiting: number; running: boolean }): string {
  const name = base ? `${base} · ${APP}` : APP;
  if (waiting > 0) return `(${waiting}) ${name}`;
  return running ? `• ${name}` : name;
}

/** The favicon's dot: waiting wins over working; null = the plain icon. */
export function badgeColor({ waiting, running }: { waiting: number; running: boolean }): string | null {
  if (waiting > 0) return BADGE_WAITING;
  return running ? BADGE_RUNNING : null;
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

let drawn: string | null = null;
/** Writes the favicon: the icon with a white-ringed dot at the top right, or the plain SVG. */
async function drawBadge(color: string | null): Promise<void> {
  if (color === drawn) return;
  drawn = color;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (!color) {
    link.type = 'image/svg+xml';
    link.href = ICON;
    return;
  }
  try {
    const img = await loadIcon();
    if (drawn !== color) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(48, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(48, 16, 10, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    link.type = 'image/png';
    link.href = canvas.toDataURL('image/png');
  } catch {
    // the icon could not be read: the plain favicon stays
  }
}

/** Keeps the tab's title and favicon up to date; called once, by the layout. `navLabel`: the sidebar entry shown. */
export function useTabStatus(navLabel: string | null): void {
  const { id: inst } = useCurrentInstance();
  const page = useActivePageValue();
  // the same query as the approvals window (every instance)
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.approvals(), refetchInterval: 10_000, refetchOnWindowFocus: true, refetchIntervalInBackground: true });
  // shared with the session list (5 s there): the shortest interval of the mounted observers wins
  const activity = useQuery({
    queryKey: ['activity', inst], queryFn: () => api.activity(inst!), enabled: inst !== null,
    refetchInterval: 10_000, refetchIntervalInBackground: true,
  });
  const waiting = approvals.data?.approvals.length ?? 0;
  const running = inst !== null && [...runMarks(activity.data?.runs ?? [], [], inst, activity.data?.subagents ?? []).values()]
    .some((m) => m.state === 'running' || m.state === 'subagents');
  const title = tabTitle({ base: page?.title || navLabel, waiting, running });
  const color = badgeColor({ waiting, running });
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => { void drawBadge(color); }, [color]);
}
