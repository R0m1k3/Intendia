import type { RunStat } from '../api';
import type { Entry } from './events';

export type ToolEntry = Extract<Entry, { kind: 'tool' }>;
/** One piece of an agent turn: an entry, or consecutive tool calls grouped in a "N étapes" card. */
export type Part = Exclude<Entry, { kind: 'tool' | 'user' }> | { kind: 'steps'; key: string; tools: ToolEntry[] };

export type Turn =
  | { kind: 'user'; key: string; entry: Extract<Entry, { kind: 'user' }>; footers: RunStat[] }
  | {
    kind: 'agent'; key: string; ts: number | null; parts: Part[]; footers: RunStat[];
    /** Markdown of the turn's replies (the "Copier" button), blank line between them. */
    text: string;
    streaming: boolean;
  };

/**
 * The thread as turns: one per user message, one per run of agent entries between two user messages (key = key of
 * its first entry). Consecutive tools become one `steps` part (key = first tool's). Run lines placed on an entry
 * (placeRunStats) go at the end of the turn holding that entry, never inside a step card; on a user message, after it.
 */
export function toTurns(entries: Entry[], footers?: Map<string, RunStat[]>): Turn[] {
  const turns: Turn[] = [];
  for (const e of entries) {
    const lines = footers?.get(e.key) ?? [];
    if (e.kind === 'user') {
      turns.push({ kind: 'user', key: e.key, entry: e, footers: [...lines] });
      continue;
    }
    let turn = turns.at(-1);
    if (!turn || turn.kind !== 'agent') {
      turn = { kind: 'agent', key: e.key, ts: e.ts, parts: [], footers: [], text: '', streaming: false };
      turns.push(turn);
    }
    if (turn.ts === null && e.ts !== null) turn.ts = e.ts;
    const last = turn.parts.at(-1);
    if (e.kind === 'tool') {
      if (last?.kind === 'steps') last.tools.push(e);
      else turn.parts.push({ kind: 'steps', key: e.key, tools: [e] });
    } else {
      turn.parts.push(e);
      if (e.kind === 'assistant') {
        turn.text = turn.text ? `${turn.text}\n\n${e.text}` : e.text;
        if (e.streaming) turn.streaming = true;
      }
    }
    turn.footers.push(...lines);
  }
  return turns;
}

/** "N étapes" with the summed duration when every step has one (live runs only: Hermes' history has none). */
export function stepsLabel(tools: ToolEntry[]): string {
  const n = `${tools.length} étape${tools.length > 1 ? 's' : ''}`;
  if (tools.some((t) => t.duration === null)) return n;
  const s = tools.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  return `${n} · ${s.toLocaleString('fr-FR', { maximumFractionDigits: s < 10 ? 1 : 0 })} s`;
}
