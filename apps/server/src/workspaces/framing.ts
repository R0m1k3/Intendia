// Framing block written at the start of a cron prompt or a kanban task body (pure functions).
import type { Workspace } from './service.js';

export type FramedArea = 'crons' | 'kanban';

const blockRe = (area: FramedArea) =>
  new RegExp(`^\\[Intendia\\] Workspace : .+ \\(([a-z0-9-]+)\\) ; dossier : ${area}\\/([a-z0-9-]+)\\n[\\s\\S]*?\\n\\[\\/Intendia\\](?:\\n\\n?|$)`);

/** Prepends the framing block (its lines, without the closing marker) to a bare text. */
export function frame(text: string, lines: string[]): string {
  return `${lines.join('\n')}\n[/Intendia]\n\n${text}`;
}

/** Splits a text into the user's part and the workspace it is framed for (block at the very start only). */
export function unframe(text: string, area: FramedArea = 'crons'): { prompt: string; slug: string | null; folder: string | null } {
  const m = blockRe(area).exec(text);
  if (!m) return { prompt: text, slug: null, folder: null };
  return { prompt: text.slice(m[0].length), slug: m[1]!, folder: m[2]! };
}

const KEY_MAX = 40;

/** Folder key: slug of a name, suffixed -2, -3… when taken; `fallback` when the name has no usable letter. */
export function folderKey(name: string, taken: Iterable<string>, fallback = 'cron'): string {
  const used = new Set(taken);
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, KEY_MAX).replace(/-+$/, '') || fallback;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const key = `${base.slice(0, KEY_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(key)) return key;
  }
}

/** Lines of the block for `<area>/<folder>` of a workspace (`lines` from `WorkspaceService.framingLines`). */
export function blockLines(
  ws: Workspace, area: FramedArea, folder: string, lines: { workdir: string; store: string; share: string }, agentPath: string,
): string[] {
  return [
    `[Intendia] Workspace : ${ws.name} (${ws.slug}) ; dossier : ${area}/${folder}`,
    lines.workdir, `Lis ${agentPath}/AGENTS.md avant de commencer.`, lines.store, lines.share,
  ];
}
