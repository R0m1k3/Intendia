// « Nouvelle session »: the workspace it is created in (route /chat/nouvelle, main.tsx).

import type { Chat } from './columns';

/**
 * The workspace of a new session of `inst`: the active chat's, else the last one used (`intendia-last-workspace`),
 * else the instance's first; only workspaces of `inst` (the session page finds its instance from its workspace).
 * Same rule as the side chat and the home page's « Demander quelque chose à Hermes… ». null: the instance has none.
 */
export function pickWorkspace(o: {
  workspaces: readonly { slug: string; instanceId: string }[];
  inst: string;
  chat: Chat;
  last: string | null;
}): string | null {
  const mine = o.workspaces.filter((w) => w.instanceId === o.inst);
  const has = (slug: string | null | undefined): slug is string => !!slug && mine.some((w) => w.slug === slug);
  const active = o.chat.open.find((x) => x.id === o.chat.active)?.slug;
  if (has(active)) return active;
  if (has(o.last)) return o.last;
  return mine[0]?.slug ?? null;
}
