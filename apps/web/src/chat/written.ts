/**
 * Files the agent wrote, read from the session history only (stored tool calls: `write_file {path}`, `patch` in
 * `replace` mode `{path}` or in `patch` mode, V4A lines `*** Update/Add/Delete/Move File:`). Live events are not
 * used: their preview is cut and has no arguments.
 */
import type { Entry } from './events';

export type WrittenOp = 'write' | 'patch' | 'delete';
export interface Written { path: string; ts: number | null; op: WrittenOp }

const V4A = /^\*\*\*\s*(Update|Add|Delete|Move) File:\s*(.+?)\s*$/;

function ops(tool: string, argsJson: string): [string, WrittenOp][] {
  let args: Record<string, unknown>;
  try {
    const v = JSON.parse(argsJson) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
    args = v as Record<string, unknown>;
  } catch {
    return [];
  }
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (tool === 'write_file') return path ? [[path, 'write']] : [];
  if (tool !== 'patch') return [];
  if (args.mode !== 'patch') return path ? [[path, 'patch']] : [];
  if (typeof args.patch !== 'string') return [];
  const out: [string, WrittenOp][] = [];
  for (const line of args.patch.split(/\r?\n/)) {
    const m = V4A.exec(line);
    if (!m) continue;
    const [, kind, target] = m as unknown as [string, string, string];
    if (kind === 'Move') {
      const [from, to] = target.split(/\s*->\s*/);
      if (from) out.push([from, 'delete']);
      if (to) out.push([to, 'patch']);
    } else out.push([target, kind === 'Delete' ? 'delete' : 'patch']);
  }
  return out;
}

/** One line per path, the last operation deciding; most recent first. */
export function writtenPaths(entries: Entry[]): Written[] {
  const last = new Map<string, Written>();
  for (const e of entries) {
    if (e.kind !== 'tool' || !e.key.startsWith('h')) continue;
    for (const [path, op] of ops(e.tool, e.preview)) {
      last.delete(path); // re-inserted: Map order = order of the last operation
      last.set(path, { path, ts: e.ts, op });
    }
  }
  return [...last.values()].reverse();
}
