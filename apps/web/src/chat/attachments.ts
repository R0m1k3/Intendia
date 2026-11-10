import type { MountInfo } from '../files/paths';

export interface Split {
  /** The message without its attachment lines. */
  text: string;
  /** Attachment paths as written (the order of the message). */
  files: string[];
}

/**
 * Files joined to a user message: the composer sends them as the last lines, one path per line. Those lines leave the
 * text and become attachments. A line counts when, trimmed, it starts with the workspace as the agent or Intendia sees
 * it, or with inbox/, files/, sessions/: the whole line is the path, so names with spaces, quotes or "(2)" pass.
 * No server call: the bubble does not jump when the existence check comes back.
 */
export function splitAttachments(text: string, m: MountInfo): Split {
  const bases = [m.agentMount, m.mount].filter(Boolean).map((b) => `${b.replace(/\/+$/, '')}/`);
  const isPath = (line: string) => /^(inbox|files|sessions)\/\S/.test(line) || bases.some((b) => line.startsWith(b) && line.length > b.length);
  const lines = text.split('\n');
  const files: string[] = [];
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]!.trim();
    if (line === '') { end--; continue; }
    if (!isPath(line)) break;
    files.unshift(line);
    end--;
  }
  if (!files.length) return { text, files };
  return { text: lines.slice(0, end).join('\n').trimEnd(), files };
}
